type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function getAllmoxyAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const clientId = requiredEnv("ALLMOXY_CLIENT_ID");
  const clientSecret = requiredEnv("ALLMOXY_CLIENT_SECRET");
  const authUrl =
    process.env.ALLMOXY_AUTH_URL ?? "https://auth.allmoxy.com/oauth2/token";

  const url = new URL(authUrl);
  url.searchParams.set("grant_type", "client_credentials");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Allmoxy auth failed (${response.status}): ${text || response.statusText}`,
    );
  }

  const data = JSON.parse(text) as {
    access_token: string;
    expires_in?: number;
    token_type?: string;
  };

  if (!data.access_token) {
    throw new Error("Allmoxy auth response missing access_token");
  }

  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + expiresInMs,
  };

  return data.access_token;
}

export function clearAllmoxyTokenCache() {
  tokenCache = null;
}
