const { AppError } = require("./errors");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, path = "payload") {
  if (!isPlainObject(value)) throw new AppError("INVALID_ARGUMENT", `${path} 必须是对象`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new AppError("INVALID_ARGUMENT", `${path} 包含未声明字段：${unknown.join(", ")}`);
}

function validateEnvelope(event, specs, options = {}) {
  if (!isPlainObject(event)) throw new AppError("INVALID_ARGUMENT", "请求格式不正确");
  // CloudBase may append platform-owned fields to the event before the
  // handler runs. They are not part of the application request envelope.
  const platformFields = Array.isArray(options.platformFields) ? options.platformFields : [];
  rejectUnknownFields(event, ["action", "payload", "requestId", ...platformFields], "request");
  if (!UUID_V4.test(event.requestId || "")) throw new AppError("INVALID_ARGUMENT", "requestId 必须是 UUID v4");
  const spec = specs[event.action];
  if (!spec) throw new AppError("ACTION_NOT_FOUND", "不支持的操作");
  const payload = event.payload === undefined ? {} : event.payload;
  rejectUnknownFields(payload, spec.fields || []);
  return { action: event.action, payload, requestId: event.requestId, spec };
}

function text(value, name, options = {}) {
  const { min = 0, max = 100, optional = false } = options;
  if ((value === undefined || value === null || value === "") && optional) return "";
  if (typeof value !== "string") throw new AppError("INVALID_ARGUMENT", `${name} 必须是文本`);
  const clean = value.trim();
  const length = Array.from(clean).length;
  if (length < min || length > max) throw new AppError("INVALID_ARGUMENT", `${name} 长度应为 ${min}–${max} 个字`);
  return clean;
}

function enumValue(value, name, allowed, optional = false) {
  if (value === undefined && optional) return undefined;
  if (!allowed.includes(value)) throw new AppError("INVALID_ARGUMENT", `${name} 取值不正确`);
  return value;
}

function integer(value, name, min, max, optional = false) {
  if (value === undefined && optional) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) throw new AppError("INVALID_ARGUMENT", `${name} 必须是 ${min}–${max} 的整数`);
  return value;
}

function stringArray(value, name, min = 1, max = 50) {
  if (!Array.isArray(value) || value.length < min || value.length > max || value.some((item) => typeof item !== "string" || !item)) {
    throw new AppError("INVALID_ARGUMENT", `${name} 必须包含 ${min}–${max} 个有效 ID`);
  }
  return Array.from(new Set(value));
}

module.exports = {
  UUID_V4,
  isPlainObject,
  rejectUnknownFields,
  validateEnvelope,
  text,
  enumValue,
  integer,
  stringArray
};
