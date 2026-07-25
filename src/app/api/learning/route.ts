import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addLearning, listLearnings } from "@/lib/learning/store";
import {
  getSessionCookieName,
  isValidSessionCookie,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireSession() {
  const cookieStore = await cookies();
  const session = cookieStore.get(getSessionCookieName())?.value;
  return isValidSessionCookie(session);
}

export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ learnings: listLearnings() });
}

export async function POST(request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      trigger?: string;
      content?: string;
      kind?: "alias" | "correction" | "preference" | "fact";
    };

    const entry = addLearning({
      trigger: body.trigger ?? "",
      content: body.content ?? "",
      kind: body.kind ?? "fact",
      source: "staff",
    });

    return NextResponse.json({ ok: true, learning: entry });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save learning";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
