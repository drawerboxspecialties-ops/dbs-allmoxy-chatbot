import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { cookies } from "next/headers";
import { ALLMOXY_FIELD_MAP } from "@/lib/allmoxy/field-map";
import { ALLMOXY_SITE_MAP } from "@/lib/allmoxy/site-map";
import { allmoxyTools } from "@/lib/allmoxy/tools";
import {
  getSessionCookieName,
  isValidSessionCookie,
} from "@/lib/auth/session";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are DBS Ops Chat, an internal assistant for Drawer Box Specialties staff.
You help look up Allmoxy data: companies/customers, contacts, orders/quotes, invoices, and payments/transactions.
You understand the full DBS Allmoxy website layout and staff terminology (see site map below). You only answer with live tool data for factual lookups — the site map is for orientation, not inventing records.

Rules:
- Read-only: never create, update, delete, or pay anything.
- Use tools for Allmoxy data. Do not invent order numbers, balances, or statuses.
- Speak in DBS Allmoxy UI language: Order #, Name (job/PO), Company (with C-code), Ship date, Status, Invoice amount, Paid.
- Work efficiently to protect the Allmoxy API (DBS was warned about oversized pulls):
  - Prefer ONE detailed lookup with related_objects over many small calls.
  - Order numbers like 603051 are Allmoxy order_id. Use findOrder (or getOrder) — never searchOrders with name= that number.
  - Job/PO labels like Ross or 26164A are the name field — use findOrder/searchOrders name for those.
  - For a single order lookup, prefer findOrder first.
  - Do not re-fetch the same entity in the same answer unless needed.
  - Prefer getOrderCountsByStatus for status totals instead of paging all orders.
  - Never attempt to download "all history" or page through the entire database.
- Prefer concise, operational answers with key IDs, status, amounts, and dates.
- If a lookup is ambiguous, ask a clarifying question or show top matches.
- If a tool errors (including rate limit), explain clearly and use any partial data you already have.
- Instance: dbs.allmoxy.com / ALLMOXY_INSTANCE=dbs.

${ALLMOXY_FIELD_MAP}

${ALLMOXY_SITE_MAP}
`;

function getChatModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("Missing DEEPSEEK_API_KEY");
  }

  const deepseek = createOpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  });

  return deepseek(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash");
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = cookieStore.get(getSessionCookieName())?.value;
  if (!isValidSessionCookie(session)) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return new Response(
      "Missing DEEPSEEK_API_KEY in env. Create one at https://platform.deepseek.com",
      { status: 500 },
    );
  }

  const body = (await request.json()) as { messages?: UIMessage[] };
  const messages = body.messages ?? [];

  try {
    const result = streamText({
      model: getChatModel(),
      system: SYSTEM_PROMPT,
      messages: await convertToModelMessages(messages),
      tools: allmoxyTools,
      // Fewer steps = fewer API round-trips while still allowing search → detail.
      stopWhen: stepCountIs(5),
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        const text =
          error instanceof Error ? error.message : "Chat request failed";
        if (/quota|rate.?limit|RESOURCE_EXHAUSTED|429|insufficient/i.test(text)) {
          return "DeepSeek API quota/balance issue. Top up at https://platform.deepseek.com and retry.";
        }
        if (/API.?key|401|403|unauth|invalid/i.test(text)) {
          return "DeepSeek API key rejected. Check DEEPSEEK_API_KEY in Vercel env.";
        }
        return text.slice(0, 300);
      },
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : "Chat request failed";
    if (/Missing DEEPSEEK_API_KEY/i.test(text)) {
      return new Response(text, { status: 500 });
    }
    if (/quota|rate.?limit|429|insufficient/i.test(text)) {
      return new Response(
        "DeepSeek API quota/balance issue. Top up at https://platform.deepseek.com and retry.",
        { status: 500 },
      );
    }
    return new Response(text.slice(0, 300), { status: 500 });
  }
}
