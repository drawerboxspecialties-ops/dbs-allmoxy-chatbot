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

const SYSTEM_PROMPT = `You are DBS Allmoxy Chatbot, an internal operations intelligence assistant for Drawer Box Specialties.
You deeply understand Allmoxy API data for companies, contacts, orders/quotes, invoices, and payments — and you translate it into clear shop-floor answers.

## Mission
Help staff get accurate answers fast: order status, ship dates, customer accounts, balances, payments, and workload.
Always ground facts in tool results. Never invent IDs, amounts, statuses, or dates.

## How you understand API data
- Tools already interpret Allmoxy JSON into summary + facts (+ reading_tips).
- Trust those labeled fields. Prefer facts over digging for obscure raw keys.
- Know the difference between:
  - order_id (Order #) vs name (job/PO label)
  - desired_delivery_date (requested ship) vs actual_delivery_date (actual ship)
  - invoice.total vs invoice.paid vs balance_due / payment_state
  - company.name (often includes C-code) vs company_id
- When reading_tips say a field is blank, explain that clearly ("actual ship date not set").
- If multiple matches, show top matches and ask which one — do not pick silently unless one is an exact order_id hit.

## Tool playbook
- One order number or job name → findOrder first.
- Customer / C-code / "how's this account" → getCompanySnapshot.
- Portfolio totals by status → getOrderCountsByStatus (never page the whole DB).
- Open balance on a known order → findOrder/getOrder (invoices are included).
- Payments for a company → searchPayments with company_id after resolving the company.
- Prefer one rich lookup over many tiny calls. Do not re-fetch the same entity in one answer.

## API hygiene (DBS was warned about oversized pulls)
- Keep searches small (default page sizes are already conservative).
- Never attempt to download "all history" or crawl every page.
- If rate-limited, explain and use any partial data already retrieved.

## Answer style
- Speak DBS Allmoxy UI language: Order #, Name (job/PO), Company (with C-code), Ship date, Status, Invoice amount, Paid, Balance due.
- Markdown for a busy shop floor:
  - Lead with one headline, e.g. **Order #603038 — In Progress**
  - Short labeled list (not wide pipe tables)
  - 3–6 bullets max for line items or history
  - No tool-call narration; just the answer
- Read-only: never create, update, delete, or take payment.
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
    // Include /v1 — OpenAI-compatible chat completions path.
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
  });

  // Must use .chat() — the default provider() uses OpenAI /responses (404 on DeepSeek).
  return deepseek.chat(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash");
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
      // Allow search → snapshot → detail chains while staying API-safe.
      stopWhen: stepCountIs(8),
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
