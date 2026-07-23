import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "dbs_ops_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

function sessionSecret() {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) {
    throw new Error("Missing APP_SESSION_SECRET");
  }
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

export function createSessionCookie(password: string) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    throw new Error("Missing APP_PASSWORD");
  }

  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  const issuedAt = Date.now().toString();
  const payload = `ok.${issuedAt}`;
  const signature = sign(payload);
  const value = `${payload}.${signature}`;

  return {
    name: COOKIE_NAME,
    value,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE_SECONDS,
    },
  };
}

export function isValidSessionCookie(cookieValue: string | undefined) {
  if (!cookieValue) return false;
  const parts = cookieValue.split(".");
  if (parts.length !== 3) return false;
  const [flag, issuedAt, signature] = parts;
  if (flag !== "ok" || !issuedAt || !signature) return false;

  const payload = `${flag}.${issuedAt}`;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return false;
  }

  const ageMs = Date.now() - Number(issuedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_AGE_SECONDS * 1000) {
    return false;
  }

  return true;
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export function clearSessionCookieOptions() {
  return {
    name: COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    },
  };
}
