import { tool } from "ai";
import { z } from "zod";
import { allmoxyFetch, toQuery, type AllmoxyListResponse } from "./client";

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

function summarizeList<T extends Record<string, unknown>>(
  data: AllmoxyListResponse<T>,
  pick: (entry: T) => Record<string, unknown>,
) {
  const entries = (data.entries ?? []).map(pick);
  return {
    total_entries: data.total_entries ?? entries.length,
    page_count: entries.length,
    total_pages: data.total_pages ?? data.pages,
    entries,
  };
}

export const allmoxyTools = {
  searchCompanies: tool({
    description:
      "Search customer companies. UI shows 'Company Name - C######'. Search by name (includes C-code), email, website, status, or role.",
    inputSchema: z.object({
      name: z.string().optional().describe("Company name (partial match)"),
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
      return summarizeList(data, (c) => ({
        company_id: c.company_id,
        name: c.name,
        email: c.email,
        website: c.website,
        status: c.status,
        company_type: c.company_type,
        role: c.role,
      }));
    },
  }),

  getCompany: tool({
    description: "Get one company by company_id.",
    inputSchema: z.object({
      company_id: z.union([z.string(), z.number()]),
      related_objects: z.string().optional(),
    }),
    execute: async ({ company_id, related_objects }) => {
      return allmoxyFetch(
        `/v2/companies/${company_id}${toQuery({ related_objects })}`,
      );
    },
  }),

  searchContacts: tool({
    description:
      "Search people/contacts by name, email, company_id, job title, or status.",
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
      return summarizeList(data, (c) => ({
        contact_id: c.contact_id,
        first_name: c.first_name,
        last_name: c.last_name,
        email: c.email,
        company_id: c.company_id,
        job_title: c.job_title,
        status: c.status,
        contact_type: c.contact_type,
      }));
    },
  }),

  getContact: tool({
    description: "Get one contact by contact_id.",
    inputSchema: z.object({
      contact_id: z.union([z.string(), z.number()]),
      related_objects: z.string().optional(),
    }),
    execute: async ({ contact_id, related_objects }) => {
      return allmoxyFetch(
        `/v2/contacts/${contact_id}${toQuery({ related_objects })}`,
      );
    },
  }),

  searchOrders: tool({
    description:
      "Search orders/quotes. IMPORTANT: Allmoxy numeric order numbers (e.g. 603051) are order_id, NOT name. Job/PO labels like Ross or 26164A go in name. Prefer findOrder for a single number/label.",
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
          "e.g. company,contact,invoices,order_products,tags,order_status_history",
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
      return summarizeList(data, (o) => ({
        order_id: o.order_id,
        name: o.name,
        status: o.status,
        order_type: o.order_type,
        company_id: o.company_id,
        contact_id: o.contact_id,
        price: o.price,
        start_date: o.start_date,
        finish_date: o.finish_date,
        desired_delivery_date: o.desired_delivery_date,
        actual_delivery_date: o.actual_delivery_date,
      }));
    },
  }),

  findOrder: tool({
    description:
      "Best tool to look up one order by Allmoxy order number (order_id like 603051) OR by job/PO name (like Ross / 26164A). Tries order_id first when the query is numeric.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Order number (order_id) or job/PO name"),
      related_objects: z
        .string()
        .optional()
        .describe(
          "Recommended: company,contact,invoices,order_products,order_status_history,tags",
        ),
    }),
    execute: async ({ query, related_objects }) => {
      const related =
        related_objects ??
        "company,contact,invoices,order_products,order_status_history,tags";
      const trimmed = query.trim();
      const numericId = /^\d+$/.test(trimmed) ? trimmed : null;

      if (numericId) {
        try {
          const byId = await allmoxyFetch<Record<string, unknown>>(
            `/v2/orders/${numericId}${toQuery({ related_objects: related })}`,
          );
          return {
            match_type: "order_id",
            order: {
              order_id: byId.order_id,
              name: byId.name,
              status: byId.status,
              order_type: byId.order_type,
              company_id: byId.company_id,
              contact_id: byId.contact_id,
              price: byId.price,
              start_date: byId.start_date,
              finish_date: byId.finish_date,
              desired_delivery_date: byId.desired_delivery_date,
              actual_delivery_date: byId.actual_delivery_date,
              company: byId.company,
              contact: byId.contact,
              invoices: byId.invoices,
              order_products: byId.order_products,
              order_status_history: byId.order_status_history,
              tags: byId.tags,
            },
          };
        } catch (error) {
          // Fall through to name search if id lookup fails.
          const message =
            error instanceof Error ? error.message : "order_id lookup failed";
          const byName = await allmoxyFetch<
            AllmoxyListResponse<Record<string, unknown>>
          >(`/v2/orders${toQuery(withSearchDefaults({ name: trimmed, per_page: 5 }))}`);
          return {
            match_type: "name_fallback_after_order_id_miss",
            order_id_error: message,
            ...summarizeList(byName, (o) => ({
              order_id: o.order_id,
              name: o.name,
              status: o.status,
              order_type: o.order_type,
              company_id: o.company_id,
              price: o.price,
            })),
          };
        }
      }

      const byName = await allmoxyFetch<AllmoxyListResponse<Record<string, unknown>>>(
        `/v2/orders${toQuery(withSearchDefaults({ name: trimmed, per_page: 8 }))}`,
      );
      return {
        match_type: "name",
        ...summarizeList(byName, (o) => ({
          order_id: o.order_id,
          name: o.name,
          status: o.status,
          order_type: o.order_type,
          company_id: o.company_id,
          contact_id: o.contact_id,
          price: o.price,
          start_date: o.start_date,
          finish_date: o.finish_date,
        })),
      };
    },
  }),

  getOrder: tool({
    description:
      "Get full details for one order by numeric Allmoxy order_id (e.g. 603051). Do not pass job names here.",
    inputSchema: z.object({
      order_id: z.union([z.string(), z.number()]),
      related_objects: z
        .string()
        .optional()
        .describe(
          "Recommended: company,contact,invoices,order_products,order_status_history,tags",
        ),
    }),
    execute: async ({ order_id, related_objects }) => {
      return allmoxyFetch(
        `/v2/orders/${order_id}${toQuery({
          related_objects:
            related_objects ??
            "company,contact,invoices,order_products,order_status_history,tags",
        })}`,
      );
    },
  }),

  getOrderCountsByStatus: tool({
    description: "Get counts of orders grouped by status.",
    inputSchema: z.object({}),
    execute: async () => allmoxyFetch("/v2/orders/counts_by_status"),
  }),

  searchInvoices: tool({
    description:
      "List invoices (orders, credit memos, finance charges, etc.). UI # is often the related order_id; AMOUNT→total; Paid→paid. Prefer order findOrder when staff ask about a specific order's invoice.",
    inputSchema: z.object({
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
      return summarizeList(data, (i) => ({
        invoice_id: i.invoice_id ?? i.iv_id,
        order_id: i.order_id,
        company_id: i.company_id,
        total: i.total,
        paid: i.paid,
        subtotal: i.subtotal,
        tax: i.tax,
        shipping: i.shipping,
        due_date: i.due_date,
        createddate: i.createddate,
      }));
    },
  }),

  getInvoice: tool({
    description: "Get one invoice by invoice id (iv_id).",
    inputSchema: z.object({
      iv_id: z.union([z.string(), z.number()]),
    }),
    execute: async ({ iv_id }) => allmoxyFetch(`/v2/invoices/${iv_id}`),
  }),

  searchPayments: tool({
    description:
      "Search payment transactions by company, contact, type, bounced flag, or date range.",
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
      return summarizeList(data, (t) => ({
        transaction_id: t.transaction_id,
        company_id: t.company_id,
        contact_id: t.contact_id,
        amount: t.amount,
        transaction_type: t.transaction_type,
        transaction_date: t.transaction_date,
        ref_num: t.ref_num,
        memo: t.memo,
        bounced: t.bounced,
        exported: t.exported,
      }));
    },
  }),

  getPayment: tool({
    description: "Get one payment transaction by transaction_id.",
    inputSchema: z.object({
      transaction_id: z.union([z.string(), z.number()]),
    }),
    execute: async ({ transaction_id }) =>
      allmoxyFetch(`/v2/transactions/${transaction_id}`),
  }),
};
