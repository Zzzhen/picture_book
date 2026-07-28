const { loadSdk, getById, queryAll, queryAllById, documentData } = require("../_shared/cloud");
const { AppError } = require("../_shared/errors");
const { success, failure } = require("../_shared/response");
const { drainBatches, deletionRetryState } = require("../_shared/deletion");

async function cleanupLookupCache(ctx) {
  const expired = await queryAll(ctx.db.collection("isbn_lookup_cache").where({
    expire_at: ctx.command.lt(new Date()),
    status: ctx.command.in(["not_found", "provider_error", "querying"])
  }), 100);
  for (const item of expired) await ctx.db.collection("isbn_lookup_cache").doc(item._id).remove();
  return { removed_count: expired.length };
}

async function cleanupEphemeralData(ctx) {
  const collections = ["idempotency_keys", "rate_limits"];
  let removed = 0;
  for (const name of collections) {
    const rows = await queryAll(ctx.db.collection(name).where({ expire_at: ctx.command.lt(new Date()) }), 100);
    for (const item of rows) await ctx.db.collection(name).doc(item._id).remove();
    removed += rows.length;
  }
  return { removed_count: removed };
}

async function processDeletionJobs(ctx) {
  const now = new Date();
  const [pending, expiredLeases] = await Promise.all([
    queryAll(ctx.db.collection("deletion_jobs").where({ status: "pending", next_attempt_at: ctx.command.lte(now) }), 20),
    queryAll(ctx.db.collection("deletion_jobs").where({ status: "processing", lease_expires_at: ctx.command.lte(now) }), 20)
  ]);
  const jobs = Array.from(new Map([...pending, ...expiredLeases].map((job) => [job._id, job])).values()).slice(0, 20);
  let processed = 0;
  const privateCollections = ["children", "user_books", "bookshelves", "bookshelf_books", "manual_book_submissions", "feedback", "events", "idempotency_keys"];
  for (const job of jobs) {
    await ctx.db.collection("deletion_jobs").doc(job._id).update({
      data: { status: "processing", lease_expires_at: new Date(Date.now() + 10 * 60_000), updated_at: ctx.now() }
    });
    try {
      for (const name of privateCollections) {
        await drainBatches(
          () => queryAll(ctx.db.collection(name).where({ owner_id: job.owner_id }), 100),
          (row) => ctx.db.collection(name).doc(row._id).remove()
        );
      }
      await drainBatches(
        () => queryAll(ctx.db.collection("book_editions").where({ created_by: job.owner_id }), 100),
        async (edition) => {
          if (edition.audit_status === "approved") {
            await ctx.db.collection("book_editions").doc(edition._id).update({ data: { created_by: "", updated_at: ctx.now() } });
          } else {
            if (edition.cover_file_id) await ctx.cloud.deleteFile({ fileList: [edition.cover_file_id] }).catch(() => {});
            await ctx.db.collection("book_editions").doc(edition._id).remove();
          }
        }
      );
      await ctx.db.collection("users").doc(job.owner_id).update({
        data: {
          status: "deleted",
          nickname: "",
          avatar_file_id: "",
          library_name: "我的绘本馆",
          city: "",
          mother_age_range: "",
          onboarding_completed: false,
          bookshelf_count: 0,
          deleted_at: ctx.now(),
          updated_at: ctx.now()
        }
      });
      await ctx.db.collection("deletion_jobs").doc(job._id).update({
        data: { status: "completed", completed_at: ctx.now(), lease_expires_at: null, last_error_code: "", updated_at: ctx.now() }
      });
      processed += 1;
    } catch (error) {
      const retry = deletionRetryState(job.attempt_count, new Date(), job.expected_completed_at || new Date(Date.now() + 24 * 60 * 60_000));
      await ctx.db.collection("deletion_jobs").doc(job._id).update({
        data: {
          ...retry,
          lease_expires_at: null,
          last_error_code: String(error.code || error.errCode || "INTERNAL_ERROR").slice(0, 80),
          updated_at: ctx.now()
        }
      });
    }
  }
  return { processed_count: processed, failed_count: jobs.length - processed };
}

async function reconcileCounts(ctx) {
  const shelves = await queryAllById(ctx, "bookshelves", { deleted_at: null }, 100000);
  let updated = 0;
  for (const shelf of shelves) {
    const count = await ctx.db.collection("bookshelf_books").where({ bookshelf_id: shelf._id, owner_id: shelf.owner_id }).count();
    if (count.total !== shelf.book_count) {
      await ctx.db.collection("bookshelves").doc(shelf._id).update({ data: { book_count: count.total, updated_at: ctx.now() } });
      updated += 1;
    }
  }
  const users = await queryAllById(ctx, "users", { deleted_at: null }, 100000);
  let userCountersUpdated = 0;
  for (const user of users) {
    const count = await ctx.db.collection("bookshelves").where({ owner_id: user._id, deleted_at: null }).count();
    if (Number(user.bookshelf_count || 0) !== count.total) {
      await ctx.db.collection("users").doc(user._id).update({ data: { bookshelf_count: count.total, updated_at: ctx.now() } });
      userCountersUpdated += 1;
    }
  }
  return {
    checked_count: shelves.length,
    updated_count: updated,
    user_checked_count: users.length,
    user_counter_updated_count: userCountersUpdated
  };
}

async function checkProviderQuota(ctx) {
  const config = await getById(ctx.db.collection("system_config"), "isbn_provider") || {};
  const day = new Date().toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const dailyId = require("../_shared/identity").deterministicId("rate_limit", ["global", "isbn_external", day]);
  const monthlyId = require("../_shared/identity").deterministicId("rate_limit", ["global", "isbn_external", month]);
  const daily = await getById(ctx.db.collection("rate_limits"), dailyId);
  const monthly = await getById(ctx.db.collection("rate_limits"), monthlyId);
  const dailyUsed = daily && daily.count || 0;
  const monthlyUsed = monthly && monthly.count || 0;
  const exceeded = dailyUsed >= Number(config.global_daily_limit || process.env.ISBN_GLOBAL_DAILY_LIMIT || 3000)
    || monthlyUsed >= Number(config.global_monthly_limit || process.env.ISBN_GLOBAL_MONTHLY_LIMIT || 50000);
  await ctx.db.collection("system_config").doc("isbn_provider").set({
    data: {
      ...documentData(config),
      quota_daily_used: dailyUsed,
      quota_monthly_used: monthlyUsed,
      quota_exceeded: exceeded,
      updated_at: ctx.now()
    }
  });
  return { quota_daily_used: dailyUsed, quota_monthly_used: monthlyUsed, quota_exceeded: exceeded };
}

const tasks = { cleanupLookupCache, cleanupEphemeralData, processDeletionJobs, reconcileCounts, checkProviderQuota };

exports.main = async (event = {}) => {
  const requestId = `maintenance_${Date.now()}`;
  try {
    const cloud = loadSdk();
    const wxContext = cloud.getWXContext();
    if (wxContext.OPENID) throw new AppError("FORBIDDEN", "维护任务禁止从小程序客户端调用");
    const task = event.task || event.TaskName;
    if (!tasks[task]) throw new AppError("ACTION_NOT_FOUND", "未知维护任务");
    const db = cloud.database();
    const ctx = { cloud, db, command: db.command, now: () => db.serverDate() };
    return success(await tasks[task](ctx), requestId);
  } catch (error) {
    return failure(error, requestId);
  }
};
