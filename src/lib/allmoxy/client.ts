import { getAllmoxyAccessToken, clearAllmoxyTokenCache } from "./auth";
import { withAllmoxyFirewall } from "./firewall";

export type AllmoxyListResponse<T> = {
  total_entries?: number;
  per_page?: number;
  pages?: number;
  total_pages?: number;
  entries?: T[];
};

function apiBaseUrl() {
  return (
    process.env.ALLMOXY_API_BASE_URL?.replace(/\/$/, "") ??
    "https://api.allmoxy.com"
  );
}

function isGet(init: RequestInit) {
  const method = (init.method ?? "GET").toUpperCase();
  return method === "GET";
}

async function allmoxyFetchUpstream<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = await getAllmoxyAccessToken();
  const url = path.startsWith("http") ? path : `${apiBaseUrl()}${path}`;

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const instance = process.env.ALLMOXY_INSTANCE ?? "dbs";
  headers.set("Directory-Name", instance);
  headers.set("Origin", `https://${instance}.allmoxy.com`);

  const contactKey = process.env.ALLMOXY_CONTACT_KEY;
  if (contactKey) {
    headers.set("contact_key", contactKey);
  }

  const contactId = process.env.ALLMOXY_CONTACT_ID;
  if (contactId) {
    headers.set("Contact-Id", contactId);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (response.status === 401 && retry) {
    clearAllmoxyTokenCache();
    return allmoxyFetchUpstream<T>(path, init, false);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Allmoxy API ${response.status} ${path}: ${text || response.statusText}`,
    );
  }

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

export type AllmoxyFetchOptions = {
  /** Skip short-term chat cache (use for sync jobs). */
  bypassCache?: boolean;
  /** Skip chat rate-limit/cache firewall and call Allmoxy directly. */
  bypassFirewall?: boolean;
};

export async function allmoxyFetch<T>(
  path: string,
  init: RequestInit = {},
  options: AllmoxyFetchOptions = {},
): Promise<T> {
  if (options.bypassFirewall || !isGet(init)) {
    return allmoxyFetchUpstream<T>(path, init);
  }

  const cacheKey = `${(init.method ?? "GET").toUpperCase()} ${path}`;
  const isDetail = /\/v2\/[^/?]+\/[^/?]+/.test(path.split("?")[0] ?? "");
  const ttlMs =
    (Number(process.env.ALLMOXY_CACHE_TTL_SECONDS) || 300) *
    1000 *
    (isDetail ? 1.5 : 1);

  return withAllmoxyFirewall<T>(
    cacheKey,
    { ttlMs, bypassCache: options.bypassCache },
    () => allmoxyFetchUpstream<T>(path, init),
  );
}

export function toQuery(
  params: Record<string, string | number | boolean | undefined | null>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
