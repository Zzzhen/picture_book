const { deterministicId } = require("./identity");

async function recordSystemEvent(ctx, eventName, properties = {}, suffix = "") {
  const eventId = `${ctx.requestId || Date.now()}_${eventName}_${suffix}`;
  const id = deterministicId("event", [ctx.userId, eventId]);
  await ctx.db.collection("events").doc(id).set({
    data: {
      owner_id: ctx.userId,
      event_name: eventName,
      event_id: eventId,
      occurred_at: new Date(),
      properties,
      created_at: ctx.now()
    }
  }).catch(() => {});
}

module.exports = { recordSystemEvent };
