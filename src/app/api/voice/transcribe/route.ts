import { cookies } from "next/headers";
import {
  getSessionCookieName,
  isValidSessionCookie,
} from "@/lib/auth/session";
import { aiPolishTranscript } from "@/lib/voice/ai-polish";
import {
  transcribeAudio,
  voiceEngineAvailable,
} from "@/lib/voice/transcribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get(getSessionCookieName())?.value;
  if (!isValidSessionCookie(session)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(voiceEngineAvailable());
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = cookieStore.get(getSessionCookieName())?.value;
  if (!isValidSessionCookie(session)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Missing audio file" }, { status: 400 });
    }
    if (file.size < 800) {
      return Response.json(
        {
          error:
            "Recording too short — hold the mic and speak a full question.",
        },
        { status: 400 },
      );
    }
    if (file.size > 20 * 1024 * 1024) {
      return Response.json({ error: "Recording too large" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "audio/webm";
    const filename =
      file.name || `voice.${mime.includes("mp4") ? "m4a" : "webm"}`;

    const result = await transcribeAudio({ bytes, filename, mime });
    const polished = await aiPolishTranscript(result.text);

    return Response.json({
      text: polished.text || result.text,
      engine: result.engine,
      polished: polished.polished,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcription failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
