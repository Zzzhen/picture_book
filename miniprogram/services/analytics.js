const { services, createRequestId } = require("./api");

const ALLOWED_PROPERTIES = new Set([
  "source",
  "scan_mode",
  "scan_session_id",
  "provider_called",
  "cache_hit",
  "result_code",
  "book_count_bucket",
  "duration_bucket"
]);

function track(eventName, properties = {}) {
  const safeProperties = Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => ALLOWED_PROPERTIES.has(key) && value !== undefined)
  );
  return services.event("trackBatch", {
    events: [{
      event_name: eventName,
      event_id: createRequestId(),
      occurred_at: new Date().toISOString(),
      properties: safeProperties
    }]
  }).catch(() => ({ accepted_count: 0, dropped_count: 1 }));
}

module.exports = { track };
