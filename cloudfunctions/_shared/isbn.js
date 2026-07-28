function normalizeIsbn(value) {
  return String(value || "").toUpperCase().replace(/[^0-9X]/g, "");
}

function valid10(isbn) {
  return /^\d{9}[\dX]$/.test(isbn) && isbn.split("").reduce((sum, digit, index) => sum + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0) % 11 === 0;
}

function valid13(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  const sum = isbn.slice(0, 12).split("").reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === Number(isbn[12]);
}

function toIsbn13(value) {
  const isbn = normalizeIsbn(value);
  if (valid13(isbn)) return isbn;
  if (!valid10(isbn)) return "";
  const body = `978${isbn.slice(0, 9)}`;
  const sum = body.split("").reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${body}${(10 - sum % 10) % 10}`;
}

module.exports = { normalizeIsbn, valid10, valid13, toIsbn13 };
