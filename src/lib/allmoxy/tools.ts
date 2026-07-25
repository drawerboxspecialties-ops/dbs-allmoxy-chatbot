import { tool } from "ai";
import { z } from "zod";
import { allmoxyFetch, toQuery, type AllmoxyListResponse } from "./client";
import {
  buildMarginDeskQuery,
  fetchMarginDeskReport,
} from "@/lib/reports/margin-desk";
import {
  understandCompany,
  understandCompanyListRow,
  understandContact,
  understandContactListRow,
  understandInvoice,
  understandInvoiceListRow,
  understandOrder,
  understandOrderListRow,
  understandPayment,
  understandPaymentListRow,
  understandStatusCounts,
} from "./understand";

const paginationSchema = {
  page: z.number().int().min(1).optional().describe("Page number, default 1"),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe("Results per page. Prefer 5-10 for searches; max 25."),
};

function withSearchDefaults<T extends { per_page?: number; page?: number }>(
  input: T,
) {
  return {
    ...input,
    page: input.page ?? 1,
    per_page: input.per_page ?? 8,
  };
}

function summarizeUnderstood<T extends Record<string, unknown>>(
  data: AllmoxyListResponse<T>,
  pick: (entry: T) => Record<string, unknown>,
) {
  const entries = (data.entries ?? []).map(pick);
  return {
    total_entries: data.total_entries ?? entries.length,
    page_count: entries.length,
    total_pages: data.total_pages ?? data.pages,
    entries,
    how_to_read:
      "Each entry has summary (one-line) and facts (labeled fields). Only report these values. If empty or missing, say not found — never invent.",
  };
}

const ORDER_RELATED =
  "company,contact,invoices,order_products,order_status_history,tags";

export const allmoxyTools = {
  searchCompanies: tool({
    description:
      "Search customer companies. UI shows 'Company Name - C######'. Search by name (includes C-code), email, website, status, or role. Returns understood company facts.",
    inputSchema: z.object({
      name: z.string().optional().describe("Company name or C-code (partial match)"),
      email: z.string().optional(),
      website: z.string().optional(),
      status: z
        .enum(["0", "1", "2"])
        .optional()
        .describe("0=inactive, 1=active, 2=deleted"),
      role: z.string().optional(),
      related_objects: z
        .string()
        .optional()
        .describe("e.g. addresses,website,phone_number"),
      ...paginationSchema,
    }),
    execute: async (input) => {
      const data = await allmoxyFetch<AllmoxyListResponse<Record<string, unknown>>>(
        `/v2/companies${toQuery(withSearchDefaults(input))}`,
      );
      return summarizeUnderstood(data, understandCompanyListRow);
    },
  }),

  getCompany: tool({
    description:
      "Get one company by company_id with interpreted payment terms, status, and C-code.",
    inputSchema: z.object({
      company_id: z.union([z.string(), z.number()]),
      related_objects: z.string().optional(),
    }),
    execute: async ({ company_id, related_objects }) => {
      const raw = await allmoxyFetch<Record<string, unknown>>(
        `/v2/companies/${company_id}${toQuery({ related_objects })}`,
      );
      return understandCompany(raw);
    },
  }),

  getCompanySnapshot: tool({
    description:
      "Best tool for a customer account overview: company profile + recent orders in one call. Use for 'tell me about company X / C-code / account'.",
    inputSchema: z.object({
      company_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Use when you already have company_id"),
      name: z
        .string()
        .optional()
        .describe("Company name or C-code when company_id unknown"),
      recent_orders: z
        .number()
        .int()
        .min(1)
        .max(15)
        .optional()
        .describe("How many recent orders to include (default 8)"),
    }),
    execute: async ({ company_id, name, recent_orders }) => {
      let companyRaw: Record<string, unknown> | null = null;
      let resolvedId = company_id != null ? String(company_id) : null;

      if (resolvedId) {
        companyRaw = await allmoxyFetch<Record<string, unknown>>(
          `/v2/companies/${resolvedId}`,
        );
      } else if (name?.trim()) {
        const found = await allmoxyFetch<
          AllmoxyListResponse<Record<string, unknown>>
        >(
          `/v2/companies${toQuery(
            withSearchDefaults({ name: name.trim(), per_page: 5 }),
          )}`,
        );
        const entries = found.entries ?? [];
        if (entries.length === 0) {
          return {
            match_type: "none",
            message: `No companies matched "${name.trim()}".`,
          };
        }
        if (entries.length > 1) {
          return {
            match_type: "ambiguous",
            message: "Multiple companies matched — ask which one, or pass company_id.",
            matches: entries.map(understandCompanyListRow),
          };
        }
        companyRaw = entries[0];
        resolvedId = String(companyRaw.company_id ?? "");
      } else {
        return {
          match_type: "error",
          message: "Provide company_id or name.",
        };
      }

      if (!companyRaw || !resolvedId) {
        return { match_type: "none", message: "Company not found." };
      }

      const orders = await allmoxyFetch<
        AllmoxyListResponse<Record<string, unknown>>
      >(
        `/v2/orders${toQuery(
          withSearchDefaults({
            company_id: resolvedId,
            per_page: recent_orders ?? 8,
            ordering: "-createddate",
          }),
        )}`,
      );

      const company = understandCompany(companyRaw);
      const recent = summarizeUnderstood(orders, understandOrderListRow);

      return {
        match_type: "company",
        company,
        recent_orders: recent,
        reading_tips: [
          "Use company.facts for account terms; use recent_orders for current workload.",
          "For invoice balance on a specific order, call findOrder/getOrder next.",
        ],
      };
    },
  }),

  searchContacts: tool({
    description:
      "Search people/contacts by name, email, company_id, job title, or status. Returns understood contact facts.",
    inputSchema: z.object({
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      company_id: z.union([z.string(), z.number()]).optional(),
      job_title: z.string().optional(),
      status: z
        .enum(["0", "1", "2"])
        .optional()
        .describe("0=inactive, 1=active, 2=deleted"),
      related_objects: z
        .string()
        .optional()
        .describe("e.g. company,addresses,website,phone_number"),
      ...paginationSchema,
    }),
    execute: async (input) => {
      const data = await allmoxyFetch<AllmoxyListResponse<Record<string, unknown>>>(
        `/v2/contacts${toQuery(withSearchDefaults(input))}`,
      );
      return summarizeUnderstood(data, understandContactListRow);
    },
  }),

  getContact: tool({
    description: "Get one contact by contact_id with interpreted name/company fields.",
    inputSchema: z.object({
      contact_id: z.union([z.string(), z.number()]),
      related_objects: z.string().optional(),
    }),
    execute: async ({ contact_id, related_objects }) => {
      const raw = await allmoxyFetch<Record<string, unknown>>(
        `/v2/contacts/${contact_id}${toQuery({
          related_objects: related_objects ?? "company",
        })}`,
      );
      return understandContact(raw);
    },
  }),

  searchOrders: tool({
    description:
      "Search orders/quotes with interpreted status, ship date, and amounts. IMPORTANT: numeric Allmoxy order numbers are order_id — use findOrder for those. Job/PO labels go in name.",
    inputSchema: z.object({
      name: z
        .string()
        .optional()
        .describe("Job/PO label only (e.g. Ross, 26164A). Not the numeric order_id."),
      company_id: z.union([z.string(), z.number()]).optional(),
      contact_id: z.union([z.string(), z.number()]).optional(),
      order_type: z.enum(["quote", "order"]).optional(),
      status: z
        .string()
        .optional()
        .describe(
          "bid | ordered | verified | in progress | completed | shipped | on hold | void",
        ),
      status__in: z
        .string()
        .optional()
        .describe("Comma-separated statuses"),
      tag: z.string().optional(),
      related_objects: z
        .string()
        .optional()
        .describe(
          "Optional. Prefer omit on lists; use findOrder/getOrder for related data.",
        ),
      start_date_start: z.string().optional(),
      start_date_end: z.string().optional(),
      finish_date_start: z.string().optional(),
      finish_date_end: z.string().optional(),
      ...paginationSchema,
      ordering: z
        .string()
        .optional()
        .describe("Sort fields, e.g. -createddate"),
    }),
    execute: async (input) => {
      const data = await allmoxyFetch<AllmoxyListResponse<Record<string, unknown>>>(
        `/v2/orders${toQuery(withSearchDefaults(input))}`,
      );
      return summarizeUnderstood(data, understandOrderListRow);
    },
  }),

  findOrder: tool({
    description:
      "Best tool for one order. Pass Allmoxy order number (order_id like 603051) OR job/PO name (Ross / 26164A). Returns fully interpreted order facts, invoices, line items, and status history.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Order number (order_id) or job/PO name"),
      related_objects: z
        .string()
        .optional()
        .describe(`Default: ${ORDER_RELATED}`),
    }),
    execute: async ({ query, related_objects }) => {
      const related = related_objects ?? ORDER_RELATED;
      const trimmed = query.trim();
      const numericId = /^\d+$/.test(trimmed) ? trimmed : null;

      if (numericId) {
        try {
          const byId = await allmoxyFetch<Record<string, unknown>>(
            `/v2/orders/${numericId}${toQuery({ related_objects: related })}`,
          );
          return {
            match_type: "order_id",
            order: understandOrder(byId),
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "order_id lookup failed";
          const byName = await allmoxyFetch<
            AllmoxyListResponse<Record<string, unknown>>
          >(
            `/v2/orders${toQuery(
              withSearchDefaults({ name: trimmed, per_page: 5 }),
            )}`,
          );
          return {
            match_type: "name_fallback_after_order_id_miss",
            order_id_error: message,
            ...summarizeUnderstood(byName, understandOrderListRow),
          };
        }
      }

      const byName = await allmoxyFetch<AllmoxyListResponse<Record<string, unknown>>>(
        `/v2/orders${toQuery(withSearchDefaults({ name: trimmed, per_page: 8 }))}`,
      );
      return {
        match_type: "name",
        ...summarizeUnderstood(byName, understandOrderListRow),
      };
    },
  }),

  getOrder: tool({
    description:
      "Full interpreted details for one order by numeric Allmoxy order_id. Prefer findOrder unless you already know the id.",
    inputSchema: z.object({
      order_id: z.union([z.string(), z.number()]),
      related_objects: z
        .string()
        .optional()
        .describe(`Default: ${ORDER_RELATED}`),
    }),
    execute: async ({ order_id, related_objects }) => {
      const raw = await allmoxyFetch<Record<string, unknown>>(
        `/v2/orders/${order_id}${toQuery({
          related_objects: related_objects ?? ORDER_RELATED,
        })}`,
      );
      return understandOrder(raw);
    },
  }),

  getOrderCountsByStatus: tool({
    description:
      "Get live counts of orders by status (portfolio totals). Use instead of paging all orders.",
    inputSchema: z.object({}),
    execute: async () => {
      const raw = await allmoxyFetch("/v2/orders/counts_by_status");
      return understandStatusCounts(raw);
    },
  }),

  searchInvoices: tool({
    description:
      "Search invoices with interpreted totals, paid, balance due, and payment state. Prefer findOrder when asking about one order's invoice. Filters: company_id, order_id, date range.",
    inputSchema: z.object({
      company_id: z.union([z.string(), z.number()]).optional(),
      order_id: z.union([z.string(), z.number()]).optional(),
      createddate_start: z.string().optional(),
      createddate_end: z.string().optional(),
      updateddate_start: z.string().optional(),
      updateddate_end: z.string().optional(),
      ordering: z.string().optional(),
      ...paginationSchema,
    }),
    execute: async (input) => {
      const data = await allmoxyFetch<AllmoxyListResponse<Record<string, unknown>>>(
        `/v2/invoices${toQuery(withSearchDefaults(input))}`,
      );
      return summarizeUnderstood(data, understandInvoiceListRow);
    },
  }),

  getInvoice: tool({
    description: "Get one invoice by invoice id (iv_id) with balance/payment interpretation.",
    inputSchema: z.object({
      iv_id: z.union([z.string(), z.number()]),
    }),
    execute: async ({ iv_id }) => {
      const raw = await allmoxyFetch<Record<string, unknown>>(
        `/v2/invoices/${iv_id}`,
      );
      return understandInvoice(raw);
    },
  }),

  searchPayments: tool({
    description:
      "Search payment transactions with interpreted company, amount, type, bounced flag.",
    inputSchema: z.object({
      company_id: z.union([z.string(), z.number()]).optional(),
      contact_id: z.union([z.string(), z.number()]).optional(),
      transaction_type: z
        .string()
        .optional()
        .describe("check | cc | credit | paypal | cash | manual | etc."),
      bounced: z.string().optional(),
      transaction_date_start: z.string().optional(),
      transaction_date_end: z.string().optional(),
      ordering: z.string().optional(),
      ...paginationSchema,
    }),
    execute: async (input) => {
      const data = await allmoxyFetch<AllmoxyListResponse<Record<string, unknown>>>(
        `/v2/transactions${toQuery(withSearchDefaults(input))}`,
      );
      return summarizeUnderstood(data, understandPaymentListRow);
    },
  }),

  getPayment: tool({
    description: "Get one payment transaction by transaction_id with interpreted fields.",
    inputSchema: z.object({
      transaction_id: z.union([z.string(), z.number()]),
    }),
    execute: async ({ transaction_id }) => {
      const raw = await allmoxyFetch<Record<string, unknown>>(
        `/v2/transactions/${transaction_id}`,
      );
      return understandPayment(raw);
    },
  }),

  generateMarginReport: tool({
    description:
      "Build the live DBS Margin Desk true-gross-margin report (same engine as dbs-shipping-report /margin). Use when staff ask for a margin report, true margin CSV, margin by ship/order date, or margin for an order/customer/job. Returns totals + a download_url for CSV. Prefer date ranges of a day/week/month — not all history. Date mode needs start+end YYYY-MM-DD.",
    inputSchema: z.object({
      mode: z
        .enum(["date", "orderNumber", "orderName", "customer"])
        .describe("How to look up orders"),
      start: z
        .string()
        .optional()
        .describe("YYYY-MM-DD start (required for date mode)"),
      end: z
        .string()
        .optional()
        .describe("YYYY-MM-DD end (required for date mode)"),
      dateField: z
        .enum(["ship", "order"])
        .optional()
        .describe("ship = actual ship date (default), order = created date"),
      query: z
        .string()
        .optional()
        .describe(
          "Order number, order/job name, or customer name/C-code for non-date modes",
        ),
    }),
    execute: async (input) => {
      if (input.mode === "date") {
        if (!input.start || !input.end) {
          return {
            error: "Date mode needs start and end as YYYY-MM-DD.",
          };
        }
      } else if (!input.query?.trim()) {
        return {
          error: "This mode needs a query (order #, job name, or customer).",
        };
      }

      try {
        const report = await fetchMarginDeskReport({
          mode: input.mode,
          start: input.start,
          end: input.end,
          dateField: input.dateField ?? "ship",
          query: input.query,
        });
        const params = buildMarginDeskQuery({
          mode: input.mode,
          start: input.start,
          end: input.end,
          dateField: input.dateField ?? "ship",
          query: input.query,
          format: "csv",
        });
        const download_url = `/api/reports/margin?${params.toString()}`;
        const t = report.totals;
        return {
          ok: true,
          summary: `True margin ${t.marginPct.toFixed(1)}% on $${t.revenue.toFixed(0)} sales · ${t.orderCount} orders · ${t.lineCount} lines · $${t.profit.toFixed(0)} gross profit`,
          totals: t,
          insights: (report.insights ?? []).slice(0, 4),
          download_url,
          download_label: "Download margin CSV",
          how_to_answer:
            "Share the headline totals in plain DBS language, then include the download_url as a markdown link like [Download margin CSV](download_url). Do not invent line items.",
        };
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "Margin Desk report failed",
        };
      }
    },
  }),
};
