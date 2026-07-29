const { AppError } = require("./errors");

function success(data, requestId) {
  return { ok: true, code: "OK", message: "", data, requestId };
}

function failure(error, requestId) {
  const safe = error instanceof AppError
    ? error
    : new AppError("INTERNAL_ERROR", "服务暂时不可用，请稍后重试");
  return {
    ok: false,
    code: safe.code,
    message: safe.message,
    data: safe.data || null,
    requestId
  };
}

async function handle(event, callback) {
  const requestId = event && event.requestId || "";
  try {
    return success(await callback(), requestId);
  } catch (error) {
    if (!(error instanceof AppError)) {
      console.error("cloud function error", {
        requestId,
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    return failure(error, requestId);
  }
}

module.exports = { success, failure, handle };
