import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getSessionCookieName,
  isValidSessionCookie,
} from "@/lib/auth/session";
import {
  fetchMarginDeskCsv,
  type MarginDeskLookupMode,
} from "@/lib/reports/margin-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseMode(raw: string | null): MarginDeskLookupMode {
  if (
    raw === "orderNumber" ||
    raw === "orderName" ||
    raw === "customer" ||
    raw === "date"
  ) {
    return raw;
  }
  return "date";
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = cookieStore.get(getSessionCookieName())?.value;
  if (!isValidSessionCookie(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mode = parseMode(searchParams.get("mode"));
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  const query = searchParams.get("query") ?? "";
  const dateField =
    searchParams.get("dateField") === "order" ? "order" : "ship";

  try {
    const { csv, filename } = await fetchMarginDeskCsv({
      mode,
      start,
      end,
      query,
      dateField,
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Margin CSV failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
