import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { polishTranscript } from "@/lib/voice/polish-transcript";

function getPolishModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY");
  const deepseek = createOpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  });
  return deepseek.chat(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash");
}

/** Deterministic polish + optional DeepSeek STT cleanup. */
export async function aiPolishTranscript(raw: string): Promise<{
  text: string;
  polished: boolean;
}> {
  const local = polishTranscript(raw, { final: true });
  if (!local) return { text: "", polished: false };
  if (!process.env.DEEPSEEK_API_KEY) {
    return { text: local, polished: false };
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
    return { text: cleaned || local, polished: true };
  } catch {
    return { text: local, polished: false };
  }
}
