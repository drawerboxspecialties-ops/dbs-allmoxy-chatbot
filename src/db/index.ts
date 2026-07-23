import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let dbSingleton: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDbPath() {
  return (
    process.env.LOCAL_DB_PATH ??
    path.join(process.cwd(), "data", "allmoxy.db")
  );
}

export function getDb() {
  if (dbSingleton) return dbSingleton;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Lightweight bootstrap so sync works without a separate migrate step.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      company_id INTEGER PRIMARY KEY,
      name TEXT,
      email TEXT,
      website TEXT,
      status TEXT,
      company_type TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contacts (
      contact_id INTEGER PRIMARY KEY,
      company_id INTEGER,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      job_title TEXT,
      status TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      order_id INTEGER PRIMARY KEY,
      name TEXT,
      status TEXT,
      order_type TEXT,
      company_id INTEGER,
      contact_id INTEGER,
      price REAL,
      start_date TEXT,
      finish_date TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      invoice_id INTEGER PRIMARY KEY,
      order_id INTEGER,
      company_id INTEGER,
      total REAL,
      paid REAL,
      due_date TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transactions (
      transaction_id INTEGER PRIMARY KEY,
      company_id INTEGER,
      contact_id INTEGER,
      amount REAL,
      transaction_type TEXT,
      transaction_date TEXT,
      ref_num TEXT,
      memo TEXT,
      updated_at TEXT,
      payload_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      stats_json TEXT,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_cursors (
      resource TEXT PRIMARY KEY,
      watermark_iso TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_company ON orders(company_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_name ON orders(name);
    CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
    CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
    CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_company ON transactions(company_id);
  `);

  dbSingleton = drizzle(sqlite, { schema });
  return dbSingleton;
}

export { schema };
