function randomBytes(length) {
  const bytes = new Uint8Array(length);
  let filled = false;
  if (typeof wx !== "undefined" && typeof wx.getRandomValues === "function") {
    try {
      const result = wx.getRandomValues({ length });
      const values = result && result.randomValues ? result.randomValues : result;
      if (values && typeof values.length === "number" && values.length >= length) {
        bytes.set(values.slice ? values.slice(0, length) : Array.from(values).slice(0, length));
        filled = true;
      }
    } catch (_) {
      filled = false;
    }
  }
  if (!filled) {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return bytes;
}

function createRequestId() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function callService(name, action, payload = {}, requestId = createRequestId()) {
  if (!wx.cloud) {
    return Promise.reject(new Error("CLOUD_NOT_INITIALIZED"));
  }
  return wx.cloud.callFunction({
    name,
    data: { action, payload, requestId },
  }).then(({ result }) => {
    if (!result || !result.ok) {
      const error = new Error((result && result.message) || "服务暂时不可用");
      error.code = (result && result.code) || "NETWORK_ERROR";
      error.data = result && result.data;
      throw error;
    }
    return result.data;
  });
}

const services = {
  user: (action, payload, requestId) => callService("userService", action, payload, requestId),
  book: (action, payload, requestId) => callService("bookService", action, payload, requestId),
  library: (action, payload, requestId) => callService("libraryService", action, payload, requestId),
  bookshelf: (action, payload, requestId) => callService("bookshelfService", action, payload, requestId),
  event: (action, payload, requestId) => callService("eventService", action, payload, requestId),
  admin: (action, payload, requestId) => callService("adminService", action, payload, requestId)
};

module.exports = { createRequestId, callService, services };
