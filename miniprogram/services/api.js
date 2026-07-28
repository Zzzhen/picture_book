function createRequestId() {
  const bytes = new Uint8Array(16);
  if (typeof wx !== "undefined" && wx.getRandomValues) {
    wx.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
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
