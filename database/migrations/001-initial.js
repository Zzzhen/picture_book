const crypto = require("node:crypto");
const indexes = require("../indexes.json");

const version = "001";
const name = "v1_core_initial_schema";
const checksum = crypto.createHash("sha256").update(JSON.stringify(indexes)).digest("hex");

async function up({ db, environment = "development" }) {
  const existing = await db.collection("schema_migrations").doc(version).get().catch(() => ({ data: null }));
  if (existing.data && existing.data.status === "completed") return existing.data;
  const startedAt = db.serverDate();
  await db.collection("schema_migrations").doc(version).set({
    data: { version, name, checksum, environment, status: "running", started_at: startedAt, completed_at: null }
  });
  await db.collection("system_config").doc("isbn_provider").set({
    data: {
      user_daily_limit: 100,
      global_daily_limit: 3000,
      global_monthly_limit: 50000,
      quota_exceeded: false,
      circuit_open_until: null,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  });
  const result = { version, name, checksum, environment, status: "completed", completed_at: new Date().toISOString() };
  await db.collection("schema_migrations").doc(version).update({
    data: { status: "completed", completed_at: db.serverDate(), result }
  });
  return result;
}

module.exports = { version, name, checksum, up };
