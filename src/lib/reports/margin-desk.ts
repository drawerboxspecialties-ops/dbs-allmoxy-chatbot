export type MarginDeskLookupMode =
  | "date"
  | "orderNumber"
  | "orderName"
  | "customer";

export type MarginDeskTotals = {
  revenue: number;
  cost: number;
  profit: number;
  marginPct: number;
  lineCount: number;
  boxCount: number;
  productCount: number;
  orderCount: number;
};

export type MarginDeskReport = {
  totals: MarginDeskTotals;
  totalMatchedOrders: number;
  totalScanned: number;
  insights?: Array<{ title: string; detail: string }>;
  meta?: {
    durationMs: number;
    cache: "hit" | "miss";
  };
};

function marginDeskBaseUrl() {
  return (
    process.env.MARGIN_REPORT_BASE_URL?.replace(/\/$/, "") ??
    "https://dbs-shipping-report.vercel.app"
  );
}

export function buildMarginDeskQuery(input: {
  mode: MarginDeskLookupMode;
  start?: string;
  end?: string;
  dateField?: "ship" | "order";
  query?: string;
  format?: "json" | "csv";
}) {
  const params = new URLSearchParams({ mode: input.mode });
  if (input.format) params.set("format", input.format);
  if (input.mode === "date") {
    params.set("start", input.start ?? "");
    params.set("end", input.end ?? "");
    params.set("dateField", input.dateField ?? "ship");
  } else {
    params.set("query", (input.query ?? "").trim());
  }
  return params;
}

export async function fetchMarginDeskReport(input: {
  mode: MarginDeskLookupMode;
  start?: string;
  end?: string;
  dateField?: "ship" | "order";
  query?: string;
}): Promise<MarginDeskReport> {
  const params = buildMarginDeskQuery({ ...input, format: "json" });
  const response = await fetch(
    `${marginDeskBaseUrl()}/api/margin-report?${params}`,
    { cache: "no-store" },
  );
  const data = (await response.json()) as MarginDeskReport & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Margin Desk failed (${response.status})`);
  }
  return data;
}

export async function fetchMarginDeskCsv(input: {
  mode: MarginDeskLookupMode;
  start?: string;
  end?: string;
  dateField?: "ship" | "order";
  query?: string;
}): Promise<{ csv: string; filename: string }> {
  const params = buildMarginDeskQuery({ ...input, format: "csv" });
  const response = await fetch(
    `${marginDeskBaseUrl()}/api/margin-report?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error || `Margin CSV failed (${response.status})`);
  }
  const csv = await response.text();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const stamp =
    input.mode === "date"
      ? `${input.start}_to_${input.end}`
      : `${input.mode}-${(input.query ?? "lookup").replace(/[^\w.-]+/g, "_").slice(0, 40)}`;
  return {
    csv,
    filename: match?.[1] || `margin-report-${stamp}.csv`,
  };
}
