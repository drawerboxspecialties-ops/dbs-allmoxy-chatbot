import { cookies } from "next/headers";
import {
  getSessionCookieName,
  isValidSessionCookie,
} from "@/lib/auth/session";
import { aiPolishTranscript } from "@/lib/voice/ai-polish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = cookieStore.get(getSessionCookieName())?.value;
  if (!isValidSessionCookie(session)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    text?: string;
  } | null;
  const raw = String(body?.text ?? "").trim();
  if (!raw) {
    return Response.json({ error: "Empty transcript" }, { status: 400 });
  }

  const result = await aiPolishTranscript(raw);
  return Response.json(result);
}
