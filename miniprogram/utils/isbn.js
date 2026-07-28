function normalizeIsbn(value) {
  return String(value || "").toUpperCase().replace(/[^0-9X]/g, "");
}

function isValidIsbn10(isbn) {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  const sum = isbn.split("").reduce((total, digit, index) => {
    const value = digit === "X" ? 10 : Number(digit);
    return total + value * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

function isValidIsbn13(isbn) {
  if (!/^\d{13}$/.test(isbn)) return false;
  const sum = isbn.slice(0, 12).split("").reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

function isValidIsbn(value) {
  const isbn = normalizeIsbn(value);
  return isbn.length === 10 ? isValidIsbn10(isbn) : isValidIsbn13(isbn);
}

function toIsbn13(value) {
  const isbn = normalizeIsbn(value);
  if (isbn.length === 13 && isValidIsbn13(isbn)) return isbn;
  if (!isValidIsbn10(isbn)) return "";
  const body = `978${isbn.slice(0, 9)}`;
  const sum = body.split("").reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

module.exports = {
  normalizeIsbn,
  isValidIsbn10,
  isValidIsbn13,
  isValidIsbn,
  toIsbn13
};
