import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAllmoxyAccessToken } from "@/lib/allmoxy/auth";
import { allmoxyFetch, toQuery } from "@/lib/allmoxy/client";
import { getFirewallStats } from "@/lib/allmoxy/firewall";
import {
  getSessionCookieName,
  isValidSessionCookie,
} from "@/lib/auth/session";

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get(getSessionCookieName())?.value;
  if (!isValidSessionCookie(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await getAllmoxyAccessToken();
    const sample = await allmoxyFetch<{ total_entries?: number }>(
      `/v2/orders${toQuery({ per_page: 1 })}`,
    );
    return NextResponse.json({
      ok: true,
      instance: process.env.ALLMOXY_INSTANCE ?? null,
      orders_total_entries: sample.total_entries ?? null,
      firewall: getFirewallStats(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Allmoxy health check failed",
        firewall: getFirewallStats(),
      },
      { status: 502 },
    );
  }
}
