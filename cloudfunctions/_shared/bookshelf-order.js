const { AppError } = require("./errors");

const NORMALIZE_THRESHOLD = -900000;

function relationSortValue(relation) {
  const value = Number(relation && relation.sort_order);
  return Number.isFinite(value) ? value : 0;
}

function stableRelations(relations) {
  return [...relations].sort((left, right) => {
    const sortDifference = relationSortValue(left) - relationSortValue(right);
    if (sortDifference) return sortDifference;
    return String(left._id || "").localeCompare(String(right._id || ""));
  });
}

function buildPinPlan(relations, selectedIds) {
  if (!Array.isArray(relations) || !Array.isArray(selectedIds) || selectedIds.length < 1) {
    throw new AppError("INVALID_ARGUMENT", "至少选择一本绘本");
  }

  const uniqueIds = new Set(selectedIds);
  if (uniqueIds.size !== selectedIds.length) {
    throw new AppError("INVALID_ARGUMENT", "user_book_ids 不能重复");
  }

  const ordered = stableRelations(relations);
  const selected = ordered.filter((relation) => uniqueIds.has(relation.user_book_id));
  if (selected.length !== uniqueIds.size) {
    throw new AppError("RELATION_NOT_FOUND", "绘本不在该书架");
  }

  const minimum = ordered.length ? relationSortValue(ordered[0]) : 0;
  if (minimum - selected.length < NORMALIZE_THRESHOLD) {
    const remaining = ordered.filter((relation) => !uniqueIds.has(relation.user_book_id));
    return {
      renormalized: true,
      updates: selected.concat(remaining).map((relation, index) => ({
        relation_id: relation._id,
        sort_order: index
      }))
    };
  }

  return {
    renormalized: false,
    updates: selected.map((relation, index) => ({
      relation_id: relation._id,
      sort_order: minimum - selected.length + index
    }))
  };
}

module.exports = { buildPinPlan };
