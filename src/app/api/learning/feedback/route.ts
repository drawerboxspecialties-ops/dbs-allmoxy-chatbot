import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { recordAnswerFeedback } from "@/lib/learning/store";
import {
  getSessionCookieName,
  isValidSessionCookie,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = cookieStore.get(getSessionCookieName())?.value;
  if (!isValidSessionCookie(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      helpful?: boolean;
      question?: string;
      answerSnippet?: string;
      note?: string;
    };

    if (typeof body.helpful !== "boolean") {
      return NextResponse.json(
        { error: "helpful must be true or false" },
        { status: 400 },
      );
    }

    const learning = recordAnswerFeedback({
      helpful: body.helpful,
      question: body.question,
      answerSnippet: body.answerSnippet,
      note: body.note,
    });

    return NextResponse.json({ ok: true, learning });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save feedback";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
