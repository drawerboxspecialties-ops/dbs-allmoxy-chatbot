import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { cookies } from "next/headers";
import {
  getSessionCookieName,
  isValidSessionCookie,
} from "@/lib/auth/session";
import { polishTranscript } from "@/lib/voice/polish-transcript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function getPolishModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY");
  const deepseek = createOpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  });
  return deepseek.chat(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash");
}

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

  // Always apply deterministic shop-floor fixes first.
  const local = polishTranscript(raw, { final: true });

  if (!process.env.DEEPSEEK_API_KEY) {
    return Response.json({ text: local, polished: false });
  }

  try {
    const { text } = await generateText({
      model: getPolishModel(),
      temperature: 0,
      system: `You clean speech-to-text for Drawer Box Specialties Allmoxy ops chat.
Fix only STT mistakes. Keep the user's intent.
Rules:
- Output ONE cleaned question/command only. No quotes, no explanation.
- Preserve order numbers (usually 5–7 digits), C-codes (C######), job/PO names.
- Prefer DBS wording: order, ship date, In Progress, invoice, company snapshot, margin report, Allmoxy, CSV.
- Do not invent facts, IDs, or details that were not spoken.
- If already clear, return it nearly unchanged.`,
      prompt: local,
    });
    const cleaned = polishTranscript(text.trim().replace(/^["']|["']$/g, ""), {
      final: true,
    });
    return Response.json({
      text: cleaned || local,
      polished: true,
    });
  } catch {
    return Response.json({ text: local, polished: false });
  }
}
