const { createMain, getById, queryAll, queryAllById, documentData } = require("../_shared/cloud");
const { AppError } = require("../_shared/errors");
const { text, enumValue, rejectUnknownFields } = require("../_shared/schema");
const { randomId } = require("../_shared/identity");
const { iso } = require("../_shared/serializers");

function validateChild(child, partial = false) {
  rejectUnknownFields(child || {}, ["nickname", "birth_year_month", "gender"], "payload.child");
  const output = {};
  if (!partial || child.nickname !== undefined) output.nickname = text(child.nickname, "孩子昵称", { min: 1, max: 20 });
  if (!partial || child.birth_year_month !== undefined) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(child.birth_year_month || "")) throw new AppError("INVALID_ARGUMENT", "出生年月格式应为 YYYY-MM");
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    if (child.birth_year_month > current) throw new AppError("INVALID_ARGUMENT", "出生年月不能晚于当前月");
    output.birth_year_month = child.birth_year_month;
  }
  if (!partial || child.gender !== undefined) output.gender = enumValue(child.gender, "性别", ["female", "male", "unspecified"]);
  return output;
}

async function bootstrap(ctx) {
  let user = ctx.user;
  if (!user) {
    user = {
      _id: ctx.userId,
      role: "user",
      status: "active",
      nickname: "",
      avatar_file_id: "",
      library_name: "我的绘本馆",
      mother_age_range: "",
      city: "",
      onboarding_completed: false,
      preferred_library_view: "grid",
      bookshelf_count: 0,
      created_at: ctx.now(),
      updated_at: ctx.now(),
      last_login_at: ctx.now(),
      deleted_at: null
    };
    await ctx.db.collection("users").doc(ctx.userId).set({ data: documentData(user) });
  } else {
    await ctx.db.collection("users").doc(ctx.userId).update({ data: { last_login_at: ctx.now() } });
  }
  return {
    user_id: ctx.userId,
    role: user.role,
    status: user.status,
    onboarding_completed: Boolean(user.onboarding_completed),
    preferred_library_view: user.preferred_library_view || "grid"
  };
}

async function getProfile(ctx) {
  const children = await queryAll(ctx.db.collection("children").where({ owner_id: ctx.userId, is_primary: true, deleted_at: null }), 1);
  const child = children[0];
  if (!child && ctx.user.onboarding_completed) throw new AppError("DATA_INCONSISTENT", "孩子资料缺失，请联系管理员");
  const [userBooks, shelfCount, pendingCount] = await Promise.all([
    queryAllById(ctx, "user_books", { owner_id: ctx.userId, deleted_at: null }, 1000),
    ctx.db.collection("bookshelves").where({ owner_id: ctx.userId, deleted_at: null }).count(),
    ctx.db.collection("manual_book_submissions").where({ owner_id: ctx.userId, status: "pending" }).count()
  ]);
  const user = ctx.user;
  return {
    user: {
      nickname: user.nickname || "",
      avatar_file_id: user.avatar_file_id || "",
      library_name: user.library_name || "我的绘本馆",
      mother_age_range: user.mother_age_range || "",
      city: user.city || "",
      preferred_library_view: user.preferred_library_view || "grid",
      status: user.status,
      role: user.role,
      created_days: user.created_at ? Math.max(0, Math.floor((Date.now() - new Date(iso(user.created_at)).getTime()) / 86400000)) : 0
    },
    child: child ? {
      child_id: child._id,
      nickname: child.nickname,
      birth_year_month: child.birth_year_month,
      gender: child.gender
    } : null,
    stats: {
      book_count: userBooks.length,
      copy_count: userBooks.reduce((total, item) => total + (item.quantity || 1), 0),
      shelf_count: shelfCount.total,
      pending_review_count: pendingCount.total,
      favorite_count: userBooks.filter((item) => item.preference === "recommended").length
    }
  };
}

async function completeOnboarding(ctx, payload) {
  if (ctx.user.onboarding_completed) throw new AppError("INVALID_STATE", "已经完成建馆");
  const child = validateChild(payload.child);
  const libraryName = text(payload.library_name, "绘本馆名称", { min: 1, max: 30 });
  const childId = randomId("child");
  await ctx.db.runTransaction(async (transaction) => {
    await transaction.collection("children").doc(childId).set({
      data: {
        owner_id: ctx.userId,
        ...child,
        is_primary: true,
        created_at: ctx.now(),
        updated_at: ctx.now(),
        deleted_at: null
      }
    });
    await transaction.collection("users").doc(ctx.userId).update({
      data: {
        library_name: libraryName,
        nickname: payload.nickname ? text(payload.nickname, "用户昵称", { max: 30 }) : ctx.user.nickname || "",
        avatar_file_id: payload.avatar_file_id ? text(payload.avatar_file_id, "头像", { max: 500 }) : ctx.user.avatar_file_id || "",
        mother_age_range: payload.mother_age_range ? text(payload.mother_age_range, "年龄范围", { max: 30 }) : "",
        city: payload.city ? text(payload.city, "城市", { max: 50 }) : "",
        onboarding_completed: true,
        updated_at: ctx.now()
      }
    });
  });
  return { user_id: ctx.userId, child_id: childId, onboarding_completed: true };
}

async function updateProfile(ctx, payload) {
  if (!payload.user && !payload.child) throw new AppError("INVALID_ARGUMENT", "至少需要更新一项资料");
  const userPatch = {};
  if (payload.user) {
    rejectUnknownFields(payload.user, ["nickname", "avatar_file_id", "library_name", "mother_age_range", "city", "preferred_library_view"], "payload.user");
    const lengths = { nickname: 30, avatar_file_id: 500, library_name: 30, mother_age_range: 30, city: 50 };
    for (const [key, max] of Object.entries(lengths)) {
      if (payload.user[key] !== undefined) userPatch[key] = text(payload.user[key], key, { min: key === "library_name" ? 1 : 0, max });
    }
    if (payload.user.preferred_library_view !== undefined) {
      userPatch.preferred_library_view = enumValue(payload.user.preferred_library_view, "绘本馆视图", ["grid", "list"]);
    }
  }
  if (Object.keys(userPatch).length) {
    await ctx.db.collection("users").doc(ctx.userId).update({ data: { ...userPatch, updated_at: ctx.now() } });
  }
  if (payload.child) {
    const patch = validateChild(payload.child, true);
    const children = await queryAll(ctx.db.collection("children").where({ owner_id: ctx.userId, is_primary: true, deleted_at: null }), 1);
    if (!children[0]) throw new AppError("CHILD_NOT_FOUND", "孩子资料不存在");
    await ctx.db.collection("children").doc(children[0]._id).update({ data: { ...patch, updated_at: ctx.now() } });
  }
  ctx.user = await getById(ctx.db.collection("users"), ctx.userId);
  return getProfile(ctx);
}

async function cancelAccount(ctx, payload) {
  if (payload.confirm_text !== "注销账号") throw new AppError("CONFIRMATION_REQUIRED", "请输入“注销账号”进行确认");
  if (ctx.user.status !== "active") throw new AppError("INVALID_STATE", "账号当前状态不可申请注销");
  const jobId = randomId("deletion");
  const firstAttemptAt = new Date();
  const completedAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await ctx.db.runTransaction(async (transaction) => {
    await transaction.collection("users").doc(ctx.userId).update({ data: { status: "deleting", updated_at: ctx.now() } });
    await transaction.collection("deletion_jobs").doc(jobId).set({
      data: {
        owner_id: ctx.userId,
        status: "pending",
        attempt_count: 0,
        next_attempt_at: firstAttemptAt,
        lease_expires_at: null,
        expected_completed_at: completedAt,
        last_error_code: "",
        created_at: ctx.now(),
        updated_at: ctx.now()
      }
    });
  });
  return { status: "deleting", deletion_job_id: jobId, expected_completed_at: completedAt.toISOString() };
}

async function restartDeletedAccount(ctx, payload) {
  if (payload.confirm !== true) throw new AppError("CONFIRMATION_REQUIRED", "需要确认重新建馆");
  if (ctx.user.status !== "deleted") throw new AppError("INVALID_STATE", "只有已注销账号可以重新建馆");
  const child = validateChild(payload.child);
  const libraryName = text(payload.library_name, "绘本馆名称", { min: 1, max: 30 });
  const childId = randomId("child");
  await ctx.db.runTransaction(async (transaction) => {
    await transaction.collection("users").doc(ctx.userId).update({
      data: { status: "active", onboarding_completed: true, library_name: libraryName, bookshelf_count: 0, deleted_at: null, updated_at: ctx.now() }
    });
    await transaction.collection("children").doc(childId).set({
      data: { owner_id: ctx.userId, ...child, is_primary: true, created_at: ctx.now(), updated_at: ctx.now(), deleted_at: null }
    });
  });
  return { user_id: ctx.userId, child_id: childId, onboarding_completed: true };
}

exports.main = createMain("userService", {
  bootstrap,
  getProfile,
  completeOnboarding,
  updateProfile,
  cancelAccount,
  restartDeletedAccount
});
