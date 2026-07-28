function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "")
    .trim();
}

function prefixes(text) {
  const chars = Array.from(text);
  const values = [];
  for (let length = 1; length <= Math.min(20, chars.length); length += 1) {
    values.push(chars.slice(0, length).join(""));
  }
  return values;
}

function tokens(text) {
  const values = [text];
  const chars = Array.from(text.replace(/\s+/g, ""));
  if (/[\u3400-\u9fff]/u.test(text)) {
    for (let index = 0; index < chars.length - 1; index += 1) values.push(chars.slice(index, index + 2).join(""));
  }
  values.push(...text.split(/[^a-z0-9]+/).filter(Boolean));
  return values;
}

function buildSearchFields(values) {
  const normalized = values.map(normalizeSearchText).filter(Boolean);
  return {
    search_prefixes: Array.from(new Set(normalized.flatMap(prefixes))).slice(0, 60),
    search_tokens: Array.from(new Set(normalized.flatMap(tokens))).slice(0, 100)
  };
}

module.exports = { normalizeSearchText, buildSearchFields };
