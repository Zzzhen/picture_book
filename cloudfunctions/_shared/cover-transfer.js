const https = require("node:https");
const { AppError } = require("./errors");
const { validateCoverUrl, resolvePublicAddresses, detectImageType } = require("./cover-security");
const { uploadCoverBuffer } = require("./qiniu-cover");

const configuredMaxBytes = Number(process.env.COVER_MAX_BYTES);
const MAX_BYTES = Number.isFinite(configuredMaxBytes)
  ? Math.min(Math.max(configuredMaxBytes, 1024), 5 * 1024 * 1024)
  : 5 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const MAX_EDGE = 6000;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function imageDimensions(buffer, type) {
  if (type === "image/png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (type === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (type === "image/webp" && buffer.length >= 30) {
    const chunk = buffer.slice(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height };
    }
    if (chunk === "VP8 " && buffer.slice(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buffer[20] === 0x2f) {
      return {
        width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8),
        height: 1 + (buffer[22] >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10)
      };
    }
  }
  return null;
}

function validateDimensions(dimensions) {
  if (
    !dimensions ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width > MAX_EDGE ||
    dimensions.height > MAX_EDGE ||
    dimensions.width * dimensions.height > MAX_PIXELS
  ) {
    throw new AppError("UNSAFE_COVER_FILE", "封面尺寸异常");
  }
  return dimensions;
}

function structurallyComplete(buffer, type) {
  if (type === "image/jpeg") return buffer.length >= 4 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  if (type === "image/png") return buffer.length >= 12 && buffer.slice(buffer.length - 12, buffer.length - 8).toString("ascii") === "IEND";
  if (type === "image/webp") return buffer.length >= 12 && buffer.readUInt32LE(4) + 8 <= buffer.length;
  return false;
}

function downloadPinned(url, address) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const request = https.request(url, {
      method: "GET",
      headers: { Accept: "image/jpeg,image/png,image/webp", "User-Agent": "FamilyPictureBookLibrary/1.0" },
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address, address.includes(":") ? 6 : 4)
    }, (response) => {
      const declared = Number(response.headers["content-length"] || 0);
      if (declared > MAX_BYTES) {
        response.destroy();
        reject(new AppError("COVER_TOO_LARGE", "封面文件超过 5 MB"));
        return;
      }
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          response.destroy(new AppError("COVER_TOO_LARGE", "封面文件超过 5 MB"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        buffer: Buffer.concat(chunks)
      }));
      response.on("error", reject);
    });
    request.setTimeout(5000, () => request.destroy(new AppError("COVER_TRANSFER_FAILED", "封面下载超时")));
    request.on("error", reject);
    request.end();
  });
}

async function fetchSafeImage(source, redirectCount = 0) {
  const url = validateCoverUrl(source);
  const addresses = await resolvePublicAddresses(url.hostname);
  const response = await downloadPinned(url, addresses[0]);
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectCount >= 2) throw new AppError("UNSAFE_COVER_URL", "封面地址重定向次数过多");
    const location = response.headers.location;
    if (!location) throw new AppError("COVER_TRANSFER_FAILED", "封面重定向无效");
    return fetchSafeImage(new URL(location, url).toString(), redirectCount + 1);
  }
  if (response.status < 200 || response.status >= 300) throw new AppError("COVER_TRANSFER_FAILED", "封面下载失败");
  const buffer = response.buffer;
  if (buffer.length > MAX_BYTES) throw new AppError("COVER_TOO_LARGE", "封面文件超过 5 MB");
  const magicType = detectImageType(buffer);
  const declaredType = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(magicType) || (declaredType && !ALLOWED_TYPES.has(declaredType))) {
    throw new AppError("UNSAFE_COVER_FILE", "封面不是允许的图片格式");
  }
  if (!structurallyComplete(buffer, magicType)) throw new AppError("UNSAFE_COVER_FILE", "封面文件不完整");
  const dimensions = validateDimensions(imageDimensions(buffer, magicType));
  return { buffer, contentType: magicType, dimensions };
}

async function transferCover(_cloud, editionId, sourceUrl) {
  if (!sourceUrl) return { cover_file_id: "", cover_status: "missing" };
  try {
    const image = await fetchSafeImage(sourceUrl);
    const upload = await uploadCoverBuffer({ editionId, body: image.buffer, contentType: image.contentType });
    return { cover_file_id: "", cover_key: upload.key, cover_url: upload.cover_url, cover_status: "ready" };
  } catch (error) {
    console.error("cover transfer failed", { editionId, code: error.code || "UNKNOWN" });
    return { cover_file_id: "", cover_status: "failed" };
  }
}

module.exports = {
  MAX_BYTES,
  MAX_PIXELS,
  MAX_EDGE,
  imageDimensions,
  validateDimensions,
  structurallyComplete,
  fetchSafeImage,
  transferCover
};
