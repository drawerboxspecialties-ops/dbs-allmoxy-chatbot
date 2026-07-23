import { desc, eq } from "drizzle-orm";
import {
  allmoxyFetch,
  toQuery,
  type AllmoxyListResponse,
} from "@/lib/allmoxy/client";
import { getDb, schema } from "./index";
import { computeIncrementalWindow } from "./sync-window";

type Row = Record<string, unknown>;

export type SyncMode = "full" | "incremental";

export type SyncStats = {
  companies: number;
  contacts: number;
  orders: number;
  invoices: number;
  transactions: number;
  pages: number;
  windowStart?: string;
  windowEnd?: string;
  bufferMinutes?: number;
  note?: string;
};

const RESOURCES = [
  "companies",
  "contacts",
  "orders",
  "invoices",
  "transactions",
] as const;

type Resource = (typeof RESOURCES)[number];

function nowIso() {
  return new Date().toISOString();
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    !Number.isNaN(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWatermark(resource: Resource): string | null {
  const db = getDb();
  const row = db
    .select()
    .from(schema.syncCursors)
    .where(eq(schema.syncCursors.resource, resource))
    .get();
  return row?.watermarkIso ?? null;
}

function setWatermark(resource: Resource, watermarkIso: string) {
  const db = getDb();
  const syncedAt = nowIso();
  db.insert(schema.syncCursors)
    .values({ resource, watermarkIso, updatedAt: syncedAt })
    .onConflictDoUpdate({
      target: schema.syncCursors.resource,
      set: { watermarkIso, updatedAt: syncedAt },
    })
    .run();
}

function assertNoOverlappingSync() {
  const db = getDb();
  const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const running = db
    .select()
    .from(schema.syncRuns)
    .where(eq(schema.syncRuns.status, "running"))
    .all();

  for (const run of running) {
    if (run.startedAt > staleBefore) {
      throw new Error(
        `Sync already running (id=${run.id}, started ${run.startedAt}). Overlapping syncs are blocked on purpose.`,
      );
    }
    db.update(schema.syncRuns)
      .set({
        status: "error",
        finishedAt: nowIso(),
        error: "Marked stale/abandoned before starting a new sync.",
      })
      .where(eq(schema.syncRuns.id, run.id))
      .run();
  }
}

async function fetchAllPages(
  basePath: string,
  query: Record<string, string | number | undefined>,
  onPage: (entries: Row[]) => void,
): Promise<number> {
  let page = 1;
  let pagesFetched = 0;
  const perPage = Number(process.env.ALLMOXY_SYNC_PER_PAGE || 50);
  const maxPages = Number(process.env.ALLMOXY_SYNC_MAX_PAGES_PER_RESOURCE || 200);

  for (;;) {
    if (pagesFetched >= maxPages) {
      throw new Error(
        `Safety stop: ${basePath} exceeded ${maxPages} pages. Use smaller windows; refuse giant historical pulls.`,
      );
    }

    const data = await allmoxyFetch<AllmoxyListResponse<Row>>(
      `${basePath}${toQuery({ ...query, page, per_page: perPage })}`,
      {},
      { bypassFirewall: true },
    );

    const entries = data.entries ?? [];
    onPage(entries);
    pagesFetched += 1;

    const totalPages = data.total_pages ?? data.pages ?? page;
    if (page >= totalPages || entries.length === 0) break;

    page += 1;
    await sleep(Number(process.env.ALLMOXY_SYNC_PAGE_DELAY_MS || 200));
  }

  return pagesFetched;
}

function dateFilterForMode(
  mode: SyncMode,
  window: { startIso: string; endIso: string } | null,
) {
  if (mode === "full" || !window) return {};
  return {
    updateddate_start: window.startIso,
    updateddate_end: window.endIso,
  };
}

export async function syncAllmoxyToLocalDb(mode: SyncMode = "incremental") {
  if (mode === "full" && process.env.ALLMOXY_ALLOW_FULL_SYNC !== "1") {
    throw new Error(
      'Full sync is locked. Set ALLMOXY_ALLOW_FULL_SYNC=1 only when you intentionally want a one-time backfill. Scheduled jobs must use "incremental".',
    );
  }

  assertNoOverlappingSync();

  const db = getDb();
  const startedAt = nowIso();

  // Use the oldest resource watermark so all entities share one safe window.
  const watermarks = RESOURCES.map((resource) => getWatermark(resource));
  const oldestWatermark =
    watermarks.filter((v): v is string => !!v).sort()[0] ?? null;

  const window =
    mode === "incremental"
      ? computeIncrementalWindow({ watermarkIso: oldestWatermark })
      : null;

  const stats: SyncStats = {
    companies: 0,
    contacts: 0,
    orders: 0,
    invoices: 0,
    transactions: 0,
    pages: 0,
    windowStart: window?.startIso,
    windowEnd: window?.endIso,
    bufferMinutes: window?.bufferMinutes,
    note: window?.reason,
  };

  const run = db
    .insert(schema.syncRuns)
    .values({
      startedAt,
      status: "running",
      mode,
      statsJson: JSON.stringify({
        plannedWindow: window,
      }),
    })
    .returning({ id: schema.syncRuns.id })
    .get();

  if (window?.skipped) {
    db.update(schema.syncRuns)
      .set({
        finishedAt: nowIso(),
        status: "success",
        statsJson: JSON.stringify(stats),
      })
      .where(eq(schema.syncRuns.id, run.id))
      .run();
    return { ok: true as const, stats, runId: run.id, skipped: true as const };
  }

  const syncedAt = nowIso();
  const filter = dateFilterForMode(
    mode,
    window ? { startIso: window.startIso, endIso: window.endIso } : null,
  );

  try {
    stats.pages += await fetchAllPages("/v2/companies", filter, (entries) => {
      for (const entry of entries) {
        const companyId = asNumber(entry.company_id);
        if (companyId == null) continue;
        db.insert(schema.companies)
          .values({
            companyId,
            name: asString(entry.name),
            email: asString(entry.email),
            website: asString(entry.website),
            status: asString(entry.status),
            companyType: asString(entry.company_type),
            updatedAt: asString(entry.updateddate ?? entry.updated_at),
            payloadJson: JSON.stringify(entry),
            syncedAt,
          })
          .onConflictDoUpdate({
            target: schema.companies.companyId,
            set: {
              name: asString(entry.name),
              email: asString(entry.email),
              website: asString(entry.website),
              status: asString(entry.status),
              companyType: asString(entry.company_type),
              updatedAt: asString(entry.updateddate ?? entry.updated_at),
              payloadJson: JSON.stringify(entry),
              syncedAt,
            },
          })
          .run();
        stats.companies += 1;
      }
    });

    stats.pages += await fetchAllPages("/v2/contacts", filter, (entries) => {
      for (const entry of entries) {
        const contactId = asNumber(entry.contact_id);
        if (contactId == null) continue;
        db.insert(schema.contacts)
          .values({
            contactId,
            companyId: asNumber(entry.company_id),
            firstName: asString(entry.first_name),
            lastName: asString(entry.last_name),
            email: asString(entry.email),
            jobTitle: asString(entry.job_title),
            status: asString(entry.status),
            updatedAt: asString(entry.updateddate ?? entry.updated_at),
            payloadJson: JSON.stringify(entry),
            syncedAt,
          })
          .onConflictDoUpdate({
            target: schema.contacts.contactId,
            set: {
              companyId: asNumber(entry.company_id),
              firstName: asString(entry.first_name),
              lastName: asString(entry.last_name),
              email: asString(entry.email),
              jobTitle: asString(entry.job_title),
              status: asString(entry.status),
              updatedAt: asString(entry.updateddate ?? entry.updated_at),
              payloadJson: JSON.stringify(entry),
              syncedAt,
            },
          })
          .run();
        stats.contacts += 1;
      }
    });

    stats.pages += await fetchAllPages("/v2/orders", filter, (entries) => {
      for (const entry of entries) {
        const orderId = asNumber(entry.order_id);
        if (orderId == null) continue;
        db.insert(schema.orders)
          .values({
            orderId,
            name: asString(entry.name),
            status: asString(entry.status),
            orderType: asString(entry.order_type),
            companyId: asNumber(entry.company_id),
            contactId: asNumber(entry.contact_id),
            price: asNumber(entry.price),
            startDate: asString(entry.start_date),
            finishDate: asString(entry.finish_date),
            updatedAt: asString(entry.updateddate ?? entry.updated_at),
            payloadJson: JSON.stringify(entry),
            syncedAt,
          })
          .onConflictDoUpdate({
            target: schema.orders.orderId,
            set: {
              name: asString(entry.name),
              status: asString(entry.status),
              orderType: asString(entry.order_type),
              companyId: asNumber(entry.company_id),
              contactId: asNumber(entry.contact_id),
              price: asNumber(entry.price),
              startDate: asString(entry.start_date),
              finishDate: asString(entry.finish_date),
              updatedAt: asString(entry.updateddate ?? entry.updated_at),
              payloadJson: JSON.stringify(entry),
              syncedAt,
            },
          })
          .run();
        stats.orders += 1;
      }
    });

    stats.pages += await fetchAllPages("/v2/invoices", filter, (entries) => {
      for (const entry of entries) {
        const invoiceId = asNumber(entry.invoice_id ?? entry.iv_id);
        if (invoiceId == null) continue;
        db.insert(schema.invoices)
          .values({
            invoiceId,
            orderId: asNumber(entry.order_id),
            companyId: asNumber(entry.company_id),
            total: asNumber(entry.total),
            paid: asNumber(entry.paid),
            dueDate: asString(entry.due_date),
            updatedAt: asString(entry.updateddate ?? entry.updated_at),
            payloadJson: JSON.stringify(entry),
            syncedAt,
          })
          .onConflictDoUpdate({
            target: schema.invoices.invoiceId,
            set: {
              orderId: asNumber(entry.order_id),
              companyId: asNumber(entry.company_id),
              total: asNumber(entry.total),
              paid: asNumber(entry.paid),
              dueDate: asString(entry.due_date),
              updatedAt: asString(entry.updateddate ?? entry.updated_at),
              payloadJson: JSON.stringify(entry),
              syncedAt,
            },
          })
          .run();
        stats.invoices += 1;
      }
    });

    stats.pages += await fetchAllPages("/v2/transactions", filter, (entries) => {
      for (const entry of entries) {
        const transactionId = asNumber(entry.transaction_id);
        if (transactionId == null) continue;
        db.insert(schema.transactions)
          .values({
            transactionId,
            companyId: asNumber(entry.company_id),
            contactId: asNumber(entry.contact_id),
            amount: asNumber(entry.amount),
            transactionType: asString(entry.transaction_type),
            transactionDate: asString(entry.transaction_date),
            refNum: asString(entry.ref_num),
            memo: asString(entry.memo),
            updatedAt: asString(entry.updateddate ?? entry.updated_at),
            payloadJson: JSON.stringify(entry),
            syncedAt,
          })
          .onConflictDoUpdate({
            target: schema.transactions.transactionId,
            set: {
              companyId: asNumber(entry.company_id),
              contactId: asNumber(entry.contact_id),
              amount: asNumber(entry.amount),
              transactionType: asString(entry.transaction_type),
              transactionDate: asString(entry.transaction_date),
              refNum: asString(entry.ref_num),
              memo: asString(entry.memo),
              updatedAt: asString(entry.updateddate ?? entry.updated_at),
              payloadJson: JSON.stringify(entry),
              syncedAt,
            },
          })
          .run();
        stats.transactions += 1;
      }
    });

    if (mode === "incremental" && window) {
      for (const resource of RESOURCES) {
        setWatermark(resource, window.endIso);
      }
    } else if (mode === "full") {
      // After a deliberate full backfill, start incremental from "now - buffer".
      const catchUp = computeIncrementalWindow({ watermarkIso: null });
      for (const resource of RESOURCES) {
        setWatermark(resource, catchUp.endIso);
      }
    }

    db.update(schema.syncRuns)
      .set({
        finishedAt: nowIso(),
        status: "success",
        statsJson: JSON.stringify(stats),
      })
      .where(eq(schema.syncRuns.id, run.id))
      .run();

    return { ok: true as const, stats, runId: run.id, skipped: false as const };
  } catch (error) {
    db.update(schema.syncRuns)
      .set({
        finishedAt: nowIso(),
        status: "error",
        statsJson: JSON.stringify(stats),
        error: error instanceof Error ? error.message : String(error),
      })
      .where(eq(schema.syncRuns.id, run.id))
      .run();
    throw error;
  }
}

/** Recent sync history for health/debugging. */
export function getRecentSyncRuns(limit = 5) {
  const db = getDb();
  return db
    .select()
    .from(schema.syncRuns)
    .orderBy(desc(schema.syncRuns.id))
    .limit(limit)
    .all();
}
