type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

type FirewallStats = {
  cacheHits: number;
  cacheMisses: number;
  coalesced: number;
  upstreamCalls: number;
  rateLimited: number;
  lastUpstreamAt: number | null;
};

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const recentCallTimestamps: number[] = [];

const stats: FirewallStats = {
  cacheHits: 0,
  cacheMisses: 0,
  coalesced: 0,
  upstreamCalls: 0,
  rateLimited: 0,
  lastUpstreamAt: null,
};

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Max Allmoxy HTTP calls per rolling minute (cache hits do not count). */
export function getRateLimitPerMinute() {
  // Conservative default: internal ops chat should stay well under Allmoxy load.
  return envInt("ALLMOXY_MAX_REQUESTS_PER_MINUTE", 10);
}

/** Default cache TTL for successful GET responses. */
export function getCacheTtlMs() {
  // Longer cache reduces repeat upstream calls across a team.
  return envInt("ALLMOXY_CACHE_TTL_SECONDS", 300) * 1000;
}

function pruneTimestamps(now: number) {
  const cutoff = now - 60_000;
  while (recentCallTimestamps.length && recentCallTimestamps[0]! < cutoff) {
    recentCallTimestamps.shift();
  }
}

function assertWithinRateLimit() {
  const now = Date.now();
  pruneTimestamps(now);
  const limit = getRateLimitPerMinute();
  if (recentCallTimestamps.length >= limit) {
    stats.rateLimited += 1;
    const retryInMs = Math.max(
      1_000,
      60_000 - (now - recentCallTimestamps[0]!),
    );
    throw new Error(
      `Allmoxy rate limit reached (${limit}/min). Cached answers still work; retry in ~${Math.ceil(retryInMs / 1000)}s.`,
    );
  }
}

function recordUpstreamCall() {
  const now = Date.now();
  pruneTimestamps(now);
  recentCallTimestamps.push(now);
  stats.upstreamCalls += 1;
  stats.lastUpstreamAt = now;
}

function cleanupExpiredCache(now: number) {
  if (cache.size < 200) return;
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export function getFirewallStats() {
  const now = Date.now();
  pruneTimestamps(now);
  return {
    ...stats,
    cacheSize: cache.size,
    inflightSize: inflight.size,
    callsInLastMinute: recentCallTimestamps.length,
    maxRequestsPerMinute: getRateLimitPerMinute(),
    cacheTtlSeconds: getCacheTtlMs() / 1000,
  };
}

/**
 * Smart firewall around Allmoxy GETs:
 * - short TTL cache (repeat questions reuse data)
 * - in-flight coalesce (same request at once = one upstream call)
 * - rolling rate limit (protects Allmoxy from bursts)
 */
export async function withAllmoxyFirewall<T>(
  cacheKey: string,
  options: { bypassCache?: boolean; ttlMs?: number },
  fetchUpstream: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const ttlMs = options.ttlMs ?? getCacheTtlMs();

  if (!options.bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      stats.cacheHits += 1;
      return cached.value as T;
    }
  }

  const existing = inflight.get(cacheKey);
  if (existing) {
    stats.coalesced += 1;
    return existing as Promise<T>;
  }

  stats.cacheMisses += 1;
  assertWithinRateLimit();

  const promise = (async () => {
    recordUpstreamCall();
    const value = await fetchUpstream();
    cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
    cleanupExpiredCache(Date.now());
    return value;
  })().finally(() => {
    inflight.delete(cacheKey);
  });

  inflight.set(cacheKey, promise);
  return promise;
}
