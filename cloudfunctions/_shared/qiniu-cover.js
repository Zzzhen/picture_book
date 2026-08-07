const REGION_UPLOAD_HOSTS = {
  z0: "https://up-z0.qiniup.com",
  z1: "https://up-z1.qiniup.com",
  z2: "https://up-z2.qiniup.com",
  "cn-east-2": "https://up-cn-east-2.qiniup.com",
  na0: "https://up-na0.qiniup.com",
  as0: "https://up-as0.qiniup.com"
};

function regionUploadHost(region) {
  const host = REGION_UPLOAD_HOSTS[String(region || "").trim()];
  if (!host) throw new Error("七牛存储区域配置无效");
  return host;
}

function buildCoverKey(prefix, editionId, extension) {
  const cleanPrefix = String(prefix || "edition-covers/").replace(/^\/+|\s+/g, "").replace(/\/+$/, "");
  const cleanId = String(editionId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const cleanExtension = String(extension || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
  if (!cleanId) throw new Error("封面版本 ID 不能为空");
  return `${cleanPrefix}/${cleanId}.${cleanExtension}`;
}

function buildPublicUrl(domain, key) {
  const value = String(domain || "").trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw new Error("七牛封面域名无效"); }
  if (parsed.protocol !== "https:") throw new Error("七牛封面域名必须使用 HTTPS");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("七牛封面域名不能包含路径");
  return `${value}/${String(key).split("/").map(encodeURIComponent).join("/")}`;
}

function qiniuConfig() {
  const accessKey = String(process.env.QINIU_ACCESS_KEY || "").trim();
  const secretKey = String(process.env.QINIU_SECRET_KEY || "").trim();
  const bucket = String(process.env.QINIU_BUCKET || "").trim();
  const configuredDomain = String(process.env.QINIU_PUBLIC_DOMAIN || "https://static.irenduan.cn").trim();
  const domain = /^https?:\/\//i.test(configuredDomain) ? configuredDomain : `https://${configuredDomain}`;
  const region = String(process.env.QINIU_REGION || "").trim();
  if (!accessKey || !secretKey || !bucket || !domain) {
    const error = new Error("七牛封面服务未配置完整");
    error.code = "QINIU_NOT_CONFIGURED";
    throw error;
  }
  if (region) regionUploadHost(region);
  return {
    accessKey,
    secretKey,
    bucket,
    domain,
    region,
    prefix: process.env.QINIU_KEY_PREFIX || "edition-covers/"
  };
}

async function uploadCoverBuffer({ editionId, body, contentType }) {
  const qiniu = require("qiniu");
  const config = qiniuConfig();
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[contentType] || "jpg";
  const key = buildCoverKey(config.prefix, editionId, extension);
  const sdkConfig = new qiniu.conf.Config({ useHttpsDomain: true });
  if (config.region) sdkConfig.regionsProvider = qiniu.httpc.Region.fromRegionId(config.region);
  const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
  const policy = new qiniu.rs.PutPolicy({ scope: `${config.bucket}:${key}`, expires: 3600 });
  const token = policy.uploadToken(mac);
  const uploader = new qiniu.form_up.FormUploader(sdkConfig);
  const extra = new qiniu.form_up.PutExtra();
  extra.mimeType = contentType;
  await uploader.put(token, key, body, extra);
  return { key, cover_url: buildPublicUrl(config.domain, key) };
}

async function deleteCoverKey(key) {
  if (!key) return false;
  const qiniu = require("qiniu");
  const config = qiniuConfig();
  const sdkConfig = new qiniu.conf.Config({ useHttpsDomain: true });
  if (config.region) sdkConfig.regionsProvider = qiniu.httpc.Region.fromRegionId(config.region);
  const mac = new qiniu.auth.digest.Mac(config.accessKey, config.secretKey);
  const manager = new qiniu.rs.BucketManager(mac, sdkConfig);
  await manager.delete(config.bucket, key);
  return true;
}

module.exports = { REGION_UPLOAD_HOSTS, regionUploadHost, buildCoverKey, buildPublicUrl, qiniuConfig, uploadCoverBuffer, deleteCoverKey };
