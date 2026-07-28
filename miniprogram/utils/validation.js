const { isValidIsbn } = require("./isbn");

function textLength(value) {
  return Array.from(String(value || "").trim()).length;
}

function isFutureMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value || "")) return true;
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return value > current;
}

function validateOnboarding(form) {
  const errors = {};
  const nicknameLength = textLength(form.nickname);
  if (!nicknameLength || nicknameLength > 20) errors.nickname = "请输入 1–20 个字的孩子昵称";
  if (isFutureMonth(form.birthMonth)) errors.birthMonth = "请选择正确且不晚于本月的出生年月";
  if (!["female", "male", "unspecified"].includes(form.gender)) errors.gender = "请选择孩子性别";
  if (form.libraryName && textLength(form.libraryName) > 30) errors.libraryName = "绘本馆名称最多 30 个字";
  return errors;
}

function validateManualBook(form) {
  const errors = {};
  if (!textLength(form.title)) errors.title = "请填写书名";
  if (form.isbn && !isValidIsbn(form.isbn)) errors.isbn = "请输入正确的 ISBN";
  return errors;
}

function validateShelf(form) {
  const errors = {};
  const nameLength = textLength(form.name);
  if (!nameLength || nameLength > 20) errors.name = "书架名称需要 1–20 个字";
  if (textLength(form.description) > 100) errors.description = "书架说明最多 100 个字";
  return errors;
}

module.exports = {
  textLength,
  validateOnboarding,
  validateManualBook,
  validateShelf
};
