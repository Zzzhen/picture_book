class AppError extends Error {
  constructor(code, message, data = null, retryable = false) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.data = data;
    this.retryable = retryable;
  }
}

function assert(condition, code, message, data) {
  if (!condition) throw new AppError(code, message, data);
}

module.exports = { AppError, assert };
