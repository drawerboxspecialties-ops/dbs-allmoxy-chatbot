import { polishTranscript } from "@/lib/voice/polish-transcript";

const OPS_PROMPT =
  "Transcribe this staff voice note for Drawer Box Specialties Allmoxy ops chat. " +
  "Return ONLY the spoken words as plain text. " +
  "Prefer DBS wording when clear: order numbers (5-7 digits), C-codes (C######), " +
  "ship date, In Progress, invoice, company snapshot, margin report, Allmoxy, CSV. " +
  "Do not invent words that were not spoken. No quotes or commentary.";

export type TranscribeResult = {
  text: string;
  engine: "groq-whisper" | "openai-whisper" | "gemini" | "local";
};

function hasGroq() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}
function hasOpenAI() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
function hasGoogle() {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
}

export function voiceEngineAvailable(): {
  available: boolean;
  engines: string[];
} {
  const engines: string[] = [];
  if (hasGroq()) engines.push("groq-whisper");
  if (hasOpenAI()) engines.push("openai-whisper");
  if (hasGoogle()) engines.push("gemini");
  return { available: engines.length > 0, engines };
}

async function transcribeGroq(
  bytes: Buffer,
  filename: string,
  mime: string,
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mime }),
    filename,
  );
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "en");
  form.append("temperature", "0");
  form.append("prompt", OPS_PROMPT);

  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: form,
    },
  );
  const data = (await response.json()) as { text?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message || `Groq STT failed (${response.status})`);
  }
  return String(data.text ?? "").trim();
}

async function transcribeOpenAI(
  bytes: Buffer,
  filename: string,
  mime: string,
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mime }),
    filename,
  );
  form.append("model", "whisper-1");
  form.append("language", "en");
  form.append("prompt", OPS_PROMPT);

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    },
  );
  const data = (await response.json()) as { text?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI STT failed (${response.status})`);
  }
  return String(data.text ?? "").trim();
}

async function transcribeGemini(
  bytes: Buffer,
  mime: string,
): Promise<string> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
  // Flash models that accept audio; avoid lite/text-only variants.
  const model =
    process.env.VOICE_GEMINI_MODEL?.trim() ||
    "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: OPS_PROMPT },
            {
              inline_data: {
                mime_type: mime || "audio/webm",
                data: bytes.toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
      },
    }),
  });
  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(data.error?.message || `Gemini STT failed (${response.status})`);
  }
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("Gemini returned empty transcript");
  return text;
}

export async function transcribeAudio(input: {
  bytes: Buffer;
  filename: string;
  mime: string;
}): Promise<TranscribeResult> {
  const errors: string[] = [];

  if (hasGroq()) {
    try {
      const text = await transcribeGroq(input.bytes, input.filename, input.mime);
      return {
        text: polishTranscript(text, { final: true }),
        engine: "groq-whisper",
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Groq failed");
    }
  }

  if (hasOpenAI()) {
    try {
      const text = await transcribeOpenAI(
        input.bytes,
        input.filename,
        input.mime,
      );
      return {
        text: polishTranscript(text, { final: true }),
        engine: "openai-whisper",
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "OpenAI failed");
    }
  }

  if (hasGoogle()) {
    try {
      const text = await transcribeGemini(input.bytes, input.mime);
      return {
        text: polishTranscript(text, { final: true }),
        engine: "gemini",
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Gemini failed");
    }
  }

  throw new Error(
    errors[0] ||
      "No speech API configured. Set GROQ_API_KEY, OPENAI_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY.",
  );
}
