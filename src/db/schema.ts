import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const companies = sqliteTable("companies", {
  companyId: integer("company_id").primaryKey(),
  name: text("name"),
  email: text("email"),
  website: text("website"),
  status: text("status"),
  companyType: text("company_type"),
  updatedAt: text("updated_at"),
  payloadJson: text("payload_json").notNull(),
  syncedAt: text("synced_at").notNull(),
});

export const contacts = sqliteTable("contacts", {
  contactId: integer("contact_id").primaryKey(),
  companyId: integer("company_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  jobTitle: text("job_title"),
  status: text("status"),
  updatedAt: text("updated_at"),
  payloadJson: text("payload_json").notNull(),
  syncedAt: text("synced_at").notNull(),
});

export const orders = sqliteTable("orders", {
  orderId: integer("order_id").primaryKey(),
  name: text("name"),
  status: text("status"),
  orderType: text("order_type"),
  companyId: integer("company_id"),
  contactId: integer("contact_id"),
  price: real("price"),
  startDate: text("start_date"),
  finishDate: text("finish_date"),
  updatedAt: text("updated_at"),
  payloadJson: text("payload_json").notNull(),
  syncedAt: text("synced_at").notNull(),
});

export const invoices = sqliteTable("invoices", {
  invoiceId: integer("invoice_id").primaryKey(),
  orderId: integer("order_id"),
  companyId: integer("company_id"),
  total: real("total"),
  paid: real("paid"),
  dueDate: text("due_date"),
  updatedAt: text("updated_at"),
  payloadJson: text("payload_json").notNull(),
  syncedAt: text("synced_at").notNull(),
});

export const transactions = sqliteTable("transactions", {
  transactionId: integer("transaction_id").primaryKey(),
  companyId: integer("company_id"),
  contactId: integer("contact_id"),
  amount: real("amount"),
  transactionType: text("transaction_type"),
  transactionDate: text("transaction_date"),
  refNum: text("ref_num"),
  memo: text("memo"),
  updatedAt: text("updated_at"),
  payloadJson: text("payload_json").notNull(),
  syncedAt: text("synced_at").notNull(),
});

export const syncRuns = sqliteTable("sync_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  status: text("status").notNull(), // running | success | error
  mode: text("mode").notNull(), // full | incremental
  statsJson: text("stats_json"),
  error: text("error"),
});

/** High-water marks for incremental sync windows (Allmoxy guidance). */
export const syncCursors = sqliteTable("sync_cursors", {
  resource: text("resource").primaryKey(),
  watermarkIso: text("watermark_iso").notNull(),
  updatedAt: text("updated_at").notNull(),
});
