const crypto = require("node:crypto");
const https = require("node:https");
const { AppError } = require("./errors");

const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

function firstValue(source, keys, fallback = "") {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") return String(source[key]);
  }
  return fallback;
}

function normalizeProviderResponse(isbn13, body) {
  const root = body.data || {};
  const item = Array.isArray(root.details) ? root.details[0] : null;
  if (!item) return null;
  const title = firstValue(item, ["title", "bookName", "book_name", "name"]);
  if (!title) return null;
  const normalized = {
    _id: `isbn_${isbn13}`,
    isbn13,
    isbn10: firstValue(item, ["isbn10"]),
    title,
    contributors_text: firstValue(item, ["author", "authors", "writer"]),
    publisher: firstValue(item, ["publisher", "press"]),
    publish_date_text: firstValue(item, ["pubDate", "publishDate", "pubdate", "publication_date"]),
    publish_place: firstValue(item, ["pubPlace"]),
    price_text: firstValue(item, ["price"]),
    classification_code: firstValue(item, ["genus"]),
    format: firstValue(item, ["format"]),
    binding_type: firstValue(item, ["binding", "binding_type"]),
    page_count_text: firstValue(item, ["page"]),
    language: firstValue(item, ["language"]),
    keywords: firstValue(item, ["keyword", "keywords"]).split(/[,，;；]/).map((value) => value.trim()).filter(Boolean).slice(0, 20),
    description: firstValue(item, ["gist", "summary", "description", "intro"]),
    catalog: firstValue(item, ["catalog"]),
    cip_text: firstValue(item, ["cipTxt"]),
    annotation: firstValue(item, ["annotation"]),
    subject: firstValue(item, ["subject"]),
    series_text: firstValue(item, ["series"]),
    batch_text: firstValue(item, ["batch"]),
    cover_source_url: firstValue(item, ["cover", "coverUrl", "img", "image"]),
    provider_task_no: firstValue(body, ["taskNo", "task_no", "requestId"]),
    provider_code: Number(firstValue(body, ["code"], "200")) || 200,
    provider_message: firstValue(body, ["message", "msg"])
  };
  normalized.provider_response_hash = crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return normalized;
}

function validateProviderEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new AppError("SERVER_MISCONFIGURED", "ISBN 服务地址配置无效");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new AppError("SERVER_MISCONFIGURED", "ISBN 服务地址必须使用 HTTPS");
  }
  return url;
}

function buildProviderRequest(endpoint, isbn13, appCode) {
  const url = validateProviderEndpoint(endpoint);
  const configuredTimeout = Number(process.env.ISBN_PROVIDER_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout)
    ? Math.max(1000, Math.min(configuredTimeout, 15_000))
    : 5000;
  return {
    url,
    options: {
      method: "POST",
      headers: {
        Authorization: `APPCODE ${appCode}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      body: new URLSearchParams({ isbn: isbn13 }).toString(),
      redirect: "manual",
      signal: createTimeoutSignal(timeout),
      timeoutMs: timeout
    }
  };
}

function createTimeoutSignal(timeout) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeout);
  }
  if (typeof AbortController === "undefined") return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  if (typeof timer.unref === "function") timer.unref();
  return controller.signal;
}

function interpretProviderBody(isbn13, body) {
  const code = Number(body && body.code);
  if (code === 200) return normalizeProviderResponse(isbn13, body);
  const message = firstValue(body || {}, ["msg", "message"], "图书信息服务返回异常");
  if (code === 400) throw new AppError("ISBN_PROVIDER_BAD_REQUEST", message, { provider_code: code });
  if (code === 500) throw new AppError("ISBN_PROVIDER_UNAVAILABLE", "图书信息服务维护中，请稍后重试", { provider_code: code }, true);
  if (code === 999) throw new AppError("ISBN_PROVIDER_UNAVAILABLE", "暂未查到可靠的图书信息，可尝试手动录入", { provider_code: code });
  throw new AppError("PROVIDER_INVALID_RESPONSE", "图书信息服务返回异常");
}

function requestWithHttps(url, options) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method,
      headers: options.headers
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_PROVIDER_RESPONSE_BYTES) {
          const error = new Error("ISBN provider response exceeded size limit");
          error.code = "ERR_RESPONSE_TOO_LARGE";
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const status = response.statusCode || 0;
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          status,
          ok: status >= 200 && status < 300,
          text: async () => body
        });
      });
      response.on("error", reject);
    });
    request.setTimeout(options.timeoutMs || 5000, () => {
      const error = new Error("ISBN provider request timed out");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function requestProvider(url, options) {
  let response;
  try {
    response = typeof fetch === "function"
      ? await fetch(url, options)
      : await requestWithHttps(url, options);
  } catch (error) {
    console.error("isbn provider transport failed", {
      name: error && error.name,
      code: error && error.code,
      message: error && error.message
    });
    throw new AppError("ISBN_PROVIDER_UNAVAILABLE", "图书信息服务暂时不可用", null, true);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new AppError("PROVIDER_INVALID_RESPONSE", "图书信息服务返回了未允许的重定向");
  }
  if (response.status === 401 || response.status === 403) {
    throw new AppError("ISBN_PROVIDER_AUTH_ERROR", "图书信息服务鉴权失败");
  }
  if (response.status === 429 || response.status >= 500) {
    console.error("isbn provider returned unavailable status", { status: response.status });
    throw new AppError("ISBN_PROVIDER_UNAVAILABLE", "图书信息服务暂时不可用", null, true);
  }
  if (!response.ok) throw new AppError("PROVIDER_INVALID_RESPONSE", "图书信息服务返回异常");
  const text = await response.text();
  if (text.length > 2 * 1024 * 1024) throw new AppError("PROVIDER_INVALID_RESPONSE", "图书信息服务返回异常");
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new AppError("PROVIDER_INVALID_RESPONSE", "图书信息服务返回异常");
  }
}

async function queryAliyunIsbn(isbn13) {
  const endpoint = process.env.ALIYUN_ISBN_ENDPOINT;
  const appCode = process.env.ALIYUN_ISBN_APPCODE;
  if (!endpoint || !appCode) throw new AppError("ISBN_PROVIDER_UNAVAILABLE", "ISBN 服务尚未配置", null, true);
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const request = buildProviderRequest(endpoint, isbn13, appCode);
      const body = await requestProvider(request.url, request.options);
      return interpretProviderBody(isbn13, body);
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === 1) throw error;
    }
  }
  throw lastError;
}

module.exports = {
  normalizeProviderResponse,
  validateProviderEndpoint,
  buildProviderRequest,
  createTimeoutSignal,
  requestWithHttps,
  interpretProviderBody,
  queryAliyunIsbn
};
