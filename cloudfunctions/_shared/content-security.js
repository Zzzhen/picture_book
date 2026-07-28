const { AppError } = require("./errors");
const { detectImageType } = require("./cover-security");
const { imageDimensions, validateDimensions, structurallyComplete, MAX_BYTES } = require("./cover-transfer");

function validateImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new AppError("INVALID_COVER_FILE", "封面文件无效");
  if (buffer.length > MAX_BYTES) throw new AppError("COVER_TOO_LARGE", "封面文件超过 5 MB");
  const contentType = detectImageType(buffer);
  if (!contentType) throw new AppError("INVALID_COVER_FILE", "封面仅支持 JPEG、PNG 或 WebP");
  if (!structurallyComplete(buffer, contentType)) throw new AppError("INVALID_COVER_FILE", "封面文件不完整");
  let dimensions;
  try { dimensions = validateDimensions(imageDimensions(buffer, contentType)); } catch (_) {
    throw new AppError("INVALID_COVER_FILE", "封面图片尺寸异常");
  }
  return { contentType, dimensions };
}

async function verifyUploadedImage(cloud, fileId) {
  if (!fileId) return "not_provided";
  let download;
  try {
    download = await cloud.downloadFile({ fileID: fileId });
  } catch (_) {
    throw new AppError("INVALID_COVER_FILE", "无法读取上传的封面");
  }
  const buffer = download.fileContent;
  const image = validateImageBuffer(buffer);
  try {
    const result = await cloud.openapi.security.imgSecCheck({
      media: { contentType: image.contentType, value: buffer }
    });
    if (result.errCode && result.errCode !== 0) throw new Error("security");
  } catch (_) {
    throw new AppError("CONTENT_SECURITY_FAILED", "封面未通过内容安全检测");
  }
  return "passed";
}

module.exports = { validateImageBuffer, verifyUploadedImage };
