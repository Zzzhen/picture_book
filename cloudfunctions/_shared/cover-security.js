const dns = require("node:dns").promises;
const net = require("node:net");
const { AppError } = require("./errors");

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
    return lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("ff") ||
      lower.startsWith("2001:db8");
  }
  const [a, b, c] = ip.split(".").map(Number);
  return a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 2 || b === 88 && c === 99 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224;
}

function configuredCoverHosts() {
  return String(process.env.COVER_SOURCE_HOST_ALLOWLIST || "")
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);
}

function hostnameAllowed(hostname, allowlist) {
  const lower = hostname.toLowerCase();
  return allowlist.some((allowed) => lower === allowed || lower.endsWith(`.${allowed}`));
}

function validateCoverUrl(value, allowedHosts = configuredCoverHosts()) {
  let url;
  try {
    url = new URL(value);
  } catch (_) {
    throw new AppError("UNSAFE_COVER_URL", "封面地址无效");
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    throw new AppError("UNSAFE_COVER_URL", "封面地址必须使用安全的 HTTPS");
  }
  if (!allowedHosts.length) throw new AppError("SERVER_MISCONFIGURED", "尚未配置封面来源域名白名单");
  if (!hostnameAllowed(url.hostname, allowedHosts)) throw new AppError("UNSAFE_COVER_URL", "封面域名不在允许列表中");
  if (net.isIP(url.hostname) && isPrivateIp(url.hostname)) throw new AppError("UNSAFE_COVER_URL", "封面地址不可访问私有网络");
  return url;
}

async function resolvePublicAddresses(hostname) {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw new AppError("UNSAFE_COVER_URL", "封面域名解析到不可访问的网络");
  }
  return records.map((record) => record.address);
}

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return "";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

module.exports = {
  isPrivateIp,
  configuredCoverHosts,
  hostnameAllowed,
  validateCoverUrl,
  resolvePublicAddresses,
  detectImageType
};
