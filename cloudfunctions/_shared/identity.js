const crypto = require("node:crypto");
const { AppError } = require("./errors");

function requireSecret(name) {
  const value = process.env[name];
  if (!value) throw new AppError("SERVER_MISCONFIGURED", `缺少服务端环境变量 ${name}`);
  return value;
}

function userIdFromOpenId(openid, secret = process.env.USER_ID_SECRET) {
  if (!openid || !secret) throw new AppError("SERVER_MISCONFIGURED", "用户身份密钥未配置");
  return `u_v1_${crypto.createHmac("sha256", secret).update(openid, "utf8").digest("hex")}`;
}

function deterministicId(kind, parts) {
  const input = ["v1", kind].concat(parts).join("|");
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

module.exports = { requireSecret, userIdFromOpenId, deterministicId, randomId };
