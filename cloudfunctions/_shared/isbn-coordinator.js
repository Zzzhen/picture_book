const { AppError } = require("./errors");

function createLookupCoordinator({ provider, ttlMs = 60_000, negativeTtlMs = 10 * 60_000 }) {
  const cache = new Map();
  const inflight = new Map();

  async function lookup(isbn) {
    const now = Date.now();
    const cached = cache.get(isbn);
    if (cached && cached.expiresAt > now) {
      if (cached.error) throw new AppError(cached.error.code, cached.error.message);
      return { edition: cached.edition, provider_called: false, cache_hit: true };
    }
    if (inflight.has(isbn)) {
      const edition = await inflight.get(isbn);
      return { edition, provider_called: false, cache_hit: true };
    }
    const task = Promise.resolve()
      .then(() => provider(isbn))
      .then((edition) => {
        if (!edition) {
          cache.set(isbn, { expiresAt: Date.now() + negativeTtlMs, error: { code: "BOOK_NOT_FOUND", message: "没有查询到这本绘本" } });
          throw new AppError("BOOK_NOT_FOUND", "没有查询到这本绘本");
        }
        cache.set(isbn, { expiresAt: Date.now() + ttlMs, edition });
        return edition;
      })
      .finally(() => inflight.delete(isbn));
    inflight.set(isbn, task);
    return { edition: await task, provider_called: true, cache_hit: false };
  }

  return { lookup, clear: () => { cache.clear(); inflight.clear(); } };
}

module.exports = { createLookupCoordinator };
