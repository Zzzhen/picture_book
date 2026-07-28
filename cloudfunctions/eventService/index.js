const { createMain, getById } = require("../_shared/cloud");
const { AppError } = require("../_shared/errors");
const { text, rejectUnknownFields } = require("../_shared/schema");
const { deterministicId, randomId } = require("../_shared/identity");

const EVENT_NAMES = new Set([
  "user_bootstrap_completed",
  "onboarding_completed",
  "add_book_clicked",
  "continuous_scan_started",
  "continuous_scan_book_added",
  "continuous_scan_finished",
  "isbn_scan_succeeded",
  "isbn_cache_hit",
  "isbn_provider_called",
  "isbn_lookup_not_found",
  "manual_book_created",
  "manual_book_resubmitted",
  "manual_book_reviewed",
  "first_book_added",
  "book_count_reached_5",
  "book_count_reached_10",
  "bookshelf_created",
  "books_added_to_shelf",
  "preference_updated",
  "library_filter_used"
]);

const PROPERTY_NAMES = new Set([
  "source",
  "scan_mode",
  "scan_session_id",
  "provider_called",
  "cache_hit",
  "result_code",
  "book_count_bucket",
  "duration_bucket"
]);

function safeProperties(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!PROPERTY_NAMES.has(key)) continue;
    if (["string", "number", "boolean"].includes(typeof item) && String(item).length <= 100) result[key] = item;
  }
  return result;
}

async function saveFeedback(ctx, event) {
  const properties = event.properties || {};
  const type = text(properties.type, "反馈类型", { min: 1, max: 30 });
  const content = text(properties.content, "反馈内容", { min: 1, max: 1000 });
  const contact = properties.contact ? text(properties.contact, "联系方式", { max: 100 }) : "";
  const id = deterministicId("feedback", [ctx.userId, event.event_id]);
  if (await getById(ctx.db.collection("feedback"), id)) return false;
  await ctx.db.collection("feedback").doc(id).set({
    data: { owner_id: ctx.userId, type, content, contact, status: "new", created_at: ctx.now(), updated_at: ctx.now() }
  });
  return true;
}

async function trackBatch(ctx, payload) {
  if (!Array.isArray(payload.events) || payload.events.length < 1 || payload.events.length > 20) {
    throw new AppError("INVALID_ARGUMENT", "events 数量应为 1–20");
  }
  let accepted = 0;
  let dropped = 0;
  for (const event of payload.events) {
    try {
      rejectUnknownFields(event, ["event_name", "event_id", "occurred_at", "properties"], "payload.events[]");
      const eventName = text(event.event_name, "event_name", { min: 1, max: 80 });
      const eventId = text(event.event_id, "event_id", { min: 1, max: 100 });
      if (eventName === "feedback_submitted") {
        if (await saveFeedback(ctx, { ...event, event_id: eventId })) accepted += 1;
        else dropped += 1;
        continue;
      }
      if (ctx.user.status !== "active") {
        dropped += 1;
        continue;
      }
      if (!EVENT_NAMES.has(eventName)) {
        dropped += 1;
        continue;
      }
      const occurredAt = new Date(event.occurred_at);
      if (Number.isNaN(occurredAt.getTime()) || Math.abs(Date.now() - occurredAt.getTime()) > 7 * 86400000) {
        dropped += 1;
        continue;
      }
      const id = deterministicId("event", [ctx.userId, eventId]);
      if (await getById(ctx.db.collection("events"), id)) {
        dropped += 1;
        continue;
      }
      await ctx.db.collection("events").doc(id).set({
        data: {
          owner_id: ctx.userId,
          event_name: eventName,
          event_id: eventId,
          occurred_at: occurredAt,
          properties: safeProperties(event.properties),
          created_at: ctx.now()
        }
      });
      accepted += 1;
    } catch (_) {
      dropped += 1;
    }
  }
  return { accepted_count: accepted, dropped_count: dropped };
}

exports.main = createMain("eventService", { trackBatch });
