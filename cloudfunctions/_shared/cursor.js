const crypto = require("node:crypto");
const { AppError } = require("./errors");

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function signature(body, binding, secret) {
  return crypto.createHmac("sha256", secret).update(`${body}.${stableStringify(binding)}`).digest("base64url");
}

function encodeCursor(position, binding, secret = process.env.CURSOR_SECRET || process.env.USER_ID_SECRET) {
  if (!secret) throw new AppError("SERVER_MISCONFIGURED", "游标密钥未配置");
  const body = Buffer.from(JSON.stringify({ v: "v1", p: position }), "utf8").toString("base64url");
  return `${body}.${signature(body, binding, secret)}`;
}

function decodeCursor(cursor, binding, secret = process.env.CURSOR_SECRET || process.env.USER_ID_SECRET) {
  try {
    if (!cursor || typeof cursor !== "string") throw new Error("empty");
    const [body, provided, extra] = cursor.split(".");
    if (!body || !provided || extra) throw new Error("format");
    const expected = signature(body, binding, secret);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) throw new Error("signature");
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (parsed.v !== "v1" || !parsed.p || typeof parsed.p.id !== "string") throw new Error("payload");
    return parsed.p;
  } catch (_) {
    throw new AppError("INVALID_CURSOR", "分页游标已失效，请重新加载");
  }
}

module.exports = { encodeCursor, decodeCursor, stableStringify };
