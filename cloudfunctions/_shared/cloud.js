const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { AppError } = require("./errors");
const { userIdFromOpenId, deterministicId } = require("./identity");
const { validateEnvelope } = require("./schema");
const { handle } = require("./response");
const contracts = require("./contracts");

function loadSdk() {
  const cloud = require("wx-server-sdk");
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  return cloud;
}

async function getById(collection, id) {
  try {
    const result = await collection.doc(id).get();
    return result.data || null;
  } catch (error) {
    if (error.errCode === -502005 || /not exist|document.*not found/i.test(error.errMsg || error.message || "")) return null;
    throw error;
  }
}

async function queryAll(query, max = 100) {
  const result = await query.limit(Math.min(100, max)).get();
  return result.data || [];
}

async function queryAllById(ctx, collectionName, condition, max = 1000) {
  const items = [];
  let afterId = "";
  while (items.length < max) {
    const where = { ...condition };
    if (afterId) where._id = ctx.command.gt(afterId);
    const result = await ctx.db.collection(collectionName).where(where).orderBy("_id", "asc").limit(Math.min(100, max - items.length)).get();
    const batch = result.data || [];
    items.push(...batch);
    if (batch.length < 100) break;
    afterId = batch[batch.length - 1]._id;
  }
  return items;
}

function documentData(value) {
  const copy = { ...value };
  delete copy._id;
  return copy;
}

async function createContext(serviceName) {
  const cloud = loadSdk();
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) throw new AppError("UNAUTHORIZED", "无法确认微信登录身份");
  const userId = userIdFromOpenId(openid);
  const db = cloud.database();
  return {
    serviceName,
    cloud,
    db,
    command: db.command,
    userId,
    now: () => db.serverDate(),
    getById,
    queryAll
  };
}

async function loadCurrentUser(ctx, options = {}) {
  const user = await getById(ctx.db.collection("users"), ctx.userId);
  if (!user && options.allowMissing) return null;
  if (!user) throw new AppError("USER_NOT_FOUND", "用户资料不存在");
  const allowed = options.statuses || ["active"];
  if (!allowed.includes(user.status)) {
    const code = user.status === "disabled" ? "USER_DISABLED" : "USER_INACTIVE";
    throw new AppError(code, user.status === "disabled" ? "账号已停用" : "账号当前不可用");
  }
  return user;
}

function allowedStatusesFor(serviceName, action) {
  if (serviceName === "eventService" && action === "trackBatch") return ["active", "disabled", "deleting"];
  if (serviceName !== "userService") return ["active"];
  if (action === "bootstrap") return ["active", "disabled", "deleting", "deleted"];
  if (action === "restartDeletedAccount") return ["deleted"];
  if (action === "getProfile") return ["active", "deleting"];
  return ["active"];
}

function idempotencyDisposition(existing) {
  if (!existing) return { type: "claim" };
  if (existing.status === "completed") return { type: "replay", result: existing.result };
  if (existing.status === "processing") throw new AppError("REQUEST_IN_PROGRESS", "相同请求正在处理中");
  if (existing.status === "failed") throw new AppError("REQUEST_ALREADY_FAILED", "相同请求已失败，请发起新的请求");
  if (existing.status === "failed_retryable") return { type: "retry" };
  throw new AppError("REQUEST_IN_PROGRESS", "相同请求状态未完成");
}

function idempotencySecret(explicitSecret) {
  const secret = explicitSecret || process.env.IDEMPOTENCY_SECRET || process.env.USER_ID_SECRET;
  if (!secret) throw new AppError("SERVER_MISCONFIGURED", "幂等结果加密密钥未配置");
  return crypto.createHash("sha256").update(`v1|idempotency|${secret}`).digest();
}

function encryptIdempotencyResult(result, explicitSecret) {
  const plaintext = zlib.gzipSync(Buffer.from(JSON.stringify(result), "utf8"));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", idempotencySecret(explicitSecret), iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  };
  if (Buffer.byteLength(JSON.stringify(payload)) > 4096) {
    return { v: 1, oversized: true, hash: crypto.createHash("sha256").update(plaintext).digest("hex") };
  }
  return payload;
}

function decryptIdempotencyResult(payload, explicitSecret) {
  if (!payload || payload.v !== 1 || payload.oversized) {
    throw new AppError("IDEMPOTENCY_REPLAY_UNAVAILABLE", "请求已完成，但结果不可再次读取");
  }
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      idempotencySecret(explicitSecret),
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const compressed = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final()
    ]);
    return JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("IDEMPOTENCY_REPLAY_UNAVAILABLE", "请求结果校验失败");
  }
}

async function claimIdempotency(ctx, action, requestId) {
  const id = deterministicId("idempotency", [ctx.userId, ctx.serviceName, action, requestId]);
  let replay;
  await ctx.db.runTransaction(async (transaction) => {
    const collection = transaction.collection("idempotency_keys");
    let existing = null;
    try {
      existing = (await collection.doc(id).get()).data;
    } catch (_) {}
    if (existing && existing.status === "completed" && existing.result_ciphertext) {
      replay = decryptIdempotencyResult(existing.result_ciphertext);
      return;
    }
    const disposition = idempotencyDisposition(existing);
    if (disposition.type === "replay") {
      replay = disposition.result;
      return;
    }
    await collection.doc(id).set({
      data: {
        owner_id: ctx.userId,
        service: ctx.serviceName,
        action,
        request_id: requestId,
        status: "processing",
        result: null,
        created_at: ctx.now(),
        updated_at: ctx.now(),
        expire_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    });
  });
  return { id, replay };
}

async function runIdempotent(ctx, action, requestId, callback) {
  const claim = await claimIdempotency(ctx, action, requestId);
  if (claim.replay !== undefined) return claim.replay;
  try {
    const result = await callback();
    const resultCiphertext = encryptIdempotencyResult(result);
    await ctx.db.collection("idempotency_keys").doc(claim.id).update({
      data: { status: "completed", result: null, result_ciphertext: resultCiphertext, updated_at: ctx.now() }
    });
    return result;
  } catch (error) {
    await ctx.db.collection("idempotency_keys").doc(claim.id).update({
      data: { status: error.retryable ? "failed_retryable" : "failed", updated_at: ctx.now() }
    }).catch(() => {});
    throw error;
  }
}

function createMain(serviceName, handlers, options = {}) {
  return async (event) => handle(event, async () => {
    const envelope = validateEnvelope(event, contracts[serviceName], {
      platformFields: ["tcbContext", "userInfo"]
    });
    const ctx = await createContext(serviceName);
    ctx.requestId = envelope.requestId;
    let user = await loadCurrentUser(ctx, {
      allowMissing: serviceName === "userService" && envelope.action === "bootstrap",
      statuses: allowedStatusesFor(serviceName, envelope.action)
    });
    if (options.admin && (!user || user.role !== "admin")) throw new AppError("FORBIDDEN", "没有管理员权限");
    ctx.user = user;
    const callback = () => handlers[envelope.action](ctx, envelope.payload);
    return envelope.spec.write
      ? runIdempotent(ctx, envelope.action, envelope.requestId, callback)
      : callback();
  });
}

module.exports = {
  loadSdk,
  getById,
  queryAll,
  queryAllById,
  createContext,
  loadCurrentUser,
  allowedStatusesFor,
  idempotencyDisposition,
  encryptIdempotencyResult,
  decryptIdempotencyResult,
  runIdempotent,
  documentData,
  createMain
};
