/**
 * Turn messy Allmoxy API payloads into staff-readable, model-friendly facts.
 * Tools should return these views so the chatbot reasons over meaning, not raw JSON.
 */

type Dict = Record<string, unknown>;

function asString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: unknown): string | null {
  const n = asNumber(value);
  if (n == null) return null;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function day(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  return raw.slice(0, 10);
}

function pick(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const record = obj as Dict;
  for (const key of keys) {
    if (record[key] != null && record[key] !== "") return record[key];
  }
  return undefined;
}

function asArray(value: unknown): Dict[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is Dict => !!v && typeof v === "object");
  }
  if (value && typeof value === "object") {
    const entries = (value as Dict).entries;
    if (Array.isArray(entries)) {
      return entries.filter((v): v is Dict => !!v && typeof v === "object");
    }
  }
  return [];
}

const STATUS_LABELS: Record<string, string> = {
  bid: "Bid",
  ordered: "Ordered",
  verified: "Verified",
  "in progress": "In Progress",
  in_progress: "In Progress",
  "on hold": "On Hold",
  on_hold: "On Hold",
  completed: "Completed",
  shipped: "Shipped",
  void: "Void",
};

const ENTITY_STATUS: Record<string, string> = {
  "0": "Inactive",
  "1": "Active",
  "2": "Deleted",
  inactive: "Inactive",
  active: "Active",
  deleted: "Deleted",
};

export function labelOrderStatus(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "";
  return STATUS_LABELS[raw.toLowerCase()] ?? raw;
}

export function labelEntityStatus(value: unknown): string {
  const raw = asString(value);
  if (!raw) return "";
  return ENTITY_STATUS[raw.toLowerCase()] ?? raw;
}

function paymentState(total: number | null, paid: number | null): string {
  if (total == null) return "Unknown";
  const paidAmt = paid ?? 0;
  if (paidAmt <= 0) return "Unpaid";
  if (paidAmt + 0.009 >= total) return "Paid";
  return "Partial";
}

function companyDisplay(company: unknown, fallbackId?: unknown): string {
  if (company && typeof company === "object") {
    const c = company as Dict;
    const name = asString(c.name);
    if (name) return name;
  }
  const id = asString(fallbackId);
  return id ? `Company #${id}` : "";
}

function contactDisplay(contact: unknown): string {
  if (!contact || typeof contact !== "object") return "";
  const c = contact as Dict;
  const full = [asString(c.first_name), asString(c.last_name)]
    .filter(Boolean)
    .join(" ");
  if (full) return full;
  return asString(c.email) || asString(c.contact_id);
}

function extractCCode(name: string): string | null {
  const m = /\bC\d{4,}\b/i.exec(name);
  return m ? m[0].toUpperCase() : null;
}

export function understandCompany(raw: Dict) {
  const name = asString(raw.name);
  const companyId = raw.company_id ?? raw.id;
  const grace = asNumber(raw.grace_period);
  const creditLimit = asNumber(raw.credit_limit);
  const checkout = asString(raw.checkout_flow);

  let paymentTerms = "";
  if (grace != null && grace > 0) paymentTerms = `On account (Net ${grace})`;
  else if (grace === 0) paymentTerms = "COD";
  else if (creditLimit != null && creditLimit > 0) paymentTerms = "On account";
  else if (checkout) paymentTerms = checkout.replace(/_/g, " ");

  const facts = {
    company_id: companyId,
    company: name,
    c_code: extractCCode(name),
    status: labelEntityStatus(raw.status),
    email: asString(raw.email) || null,
    website: asString(raw.website) || null,
    role: asString(raw.role) || asString(raw.company_type) || null,
    phone: asString(pick(raw, ["phone", "phone_number", "main_phone"])) || null,
    grace_period_days: grace,
    credit_limit: money(creditLimit),
    payment_terms: paymentTerms || null,
    checkout_flow: checkout || null,
  };

  return {
    entity: "company" as const,
    summary: [
      name || `Company #${asString(companyId)}`,
      facts.status,
      facts.payment_terms,
      facts.email,
    ]
      .filter(Boolean)
      .join(" · "),
    facts,
    reading_tips: [
      "Company display names often end with C-codes like C004321.",
      "grace_period 0 usually means COD; >0 means Net X days on account.",
      "Null payment_options is common — infer terms from grace_period/credit_limit.",
    ],
  };
}

export function understandContact(raw: Dict) {
  const name = contactDisplay(raw) || `Contact #${asString(raw.contact_id)}`;
  const companyName = companyDisplay(raw.company, raw.company_id);
  const facts = {
    contact_id: raw.contact_id,
    name,
    first_name: asString(raw.first_name) || null,
    last_name: asString(raw.last_name) || null,
    email: asString(raw.email) || null,
    job_title: asString(raw.job_title) || null,
    company_id: raw.company_id ?? null,
    company: companyName || null,
    status: labelEntityStatus(raw.status) || null,
    contact_type: asString(raw.contact_type) || null,
  };

  return {
    entity: "contact" as const,
    summary: [name, companyName, facts.email, facts.job_title]
      .filter(Boolean)
      .join(" · "),
    facts,
  };
}

function understandInvoiceLite(raw: Dict) {
  const totalN = asNumber(raw.total);
  const paidN = asNumber(raw.paid);
  const balance =
    totalN == null ? null : Math.max(0, totalN - (paidN ?? 0));
  return {
    invoice_id: raw.invoice_id ?? raw.iv_id,
    order_id: raw.order_id ?? null,
    company_id: raw.company_id ?? null,
    type: asString(raw.invoice_type || raw.type) || null,
    total: money(totalN),
    paid: money(paidN),
    balance_due: money(balance),
    payment_state: paymentState(totalN, paidN),
    due_date: day(raw.due_date),
    date: day(raw.invoice_date || raw.createddate),
  };
}

function understandProductLite(raw: Dict) {
  return {
    product_id: raw.product_id ?? raw.order_product_id ?? raw.id ?? null,
    name:
      asString(raw.name) ||
      asString(raw.product_name) ||
      asString(raw.description) ||
      null,
    qty: asNumber(raw.qty ?? raw.quantity ?? raw.total_items),
    price: money(raw.price ?? raw.total ?? raw.line_total),
    status: asString(raw.status) || null,
  };
}

function understandStatusEvent(raw: Dict) {
  return {
    status: labelOrderStatus(raw.status ?? raw.new_status ?? raw.to_status),
    at: day(raw.createddate || raw.updateddate || raw.date) || asString(raw.createddate),
    by: asString(raw.created_by || raw.user || raw.contact_name) || null,
    note: asString(raw.note || raw.notes || raw.comment) || null,
  };
}

export function understandOrder(raw: Dict) {
  const orderId = raw.order_id ?? raw.id;
  const jobName = asString(raw.name);
  const status = labelOrderStatus(raw.status);
  const companyName = companyDisplay(raw.company, raw.company_id);
  const contactName = contactDisplay(raw.contact);

  const invoices = asArray(raw.invoices).map(understandInvoiceLite);
  const primaryInvoice = invoices[0] ?? null;
  const invoiceTotal =
    primaryInvoice?.total ??
    money(raw.price) ??
    money(pick(raw, ["total", "order_total"]));
  const invoicePaid = primaryInvoice?.paid ?? null;
  const balanceDue = primaryInvoice?.balance_due ?? null;

  const requestedShip = day(raw.desired_delivery_date);
  const actualShip = day(raw.actual_delivery_date);
  const finishDate = day(raw.finish_date);
  const shipDate = actualShip || requestedShip || finishDate;

  const products = asArray(raw.order_products)
    .slice(0, 12)
    .map(understandProductLite);
  const history = asArray(raw.order_status_history)
    .slice(-8)
    .map(understandStatusEvent);
  const tags = asArray(raw.tags)
    .map((t) => asString(t.name || t.tag || t.label || t))
    .filter(Boolean);

  const tips: string[] = [];
  if (!actualShip && requestedShip) {
    tips.push("Ship date shown is requested (desired_delivery_date); actual is blank.");
  }
  if (actualShip) {
    tips.push("Actual ship date is set (actual_delivery_date).");
  }
  if (!primaryInvoice && asNumber(raw.price) != null) {
    tips.push("No invoice object attached — showing order price as amount.");
  }

  const facts = {
    order_number: orderId,
    job_name: jobName || null,
    order_type: asString(raw.order_type) || null,
    status,
    company_id: raw.company_id ?? null,
    company: companyName || null,
    c_code: extractCCode(companyName),
    contact_id: raw.contact_id ?? null,
    contact: contactName || null,
    ship_date: shipDate,
    ship_date_requested: requestedShip,
    ship_date_actual: actualShip,
    finish_date: finishDate,
    start_date: day(raw.start_date),
    amount: invoiceTotal,
    paid: invoicePaid,
    balance_due: balanceDue,
    payment_state: primaryInvoice?.payment_state ?? null,
    shipping_method: asString(raw.shipping_method) || null,
    shipping_instructions: asString(raw.shipping_instructions) || null,
    item_count:
      asNumber(raw.total_items) ??
      (products.length > 0 ? products.length : null),
    tags: tags.length ? tags : null,
    description: asString(raw.description) || null,
  };

  return {
    entity: "order" as const,
    summary: [
      orderId != null ? `Order #${orderId}` : "Order",
      jobName,
      status,
      companyName,
      invoiceTotal,
      facts.payment_state,
    ]
      .filter(Boolean)
      .join(" · "),
    facts,
    invoices: invoices.length ? invoices : null,
    line_items: products.length ? products : null,
    status_history: history.length ? history : null,
    reading_tips: tips,
  };
}

export function understandInvoice(raw: Dict) {
  const lite = understandInvoiceLite(raw);
  const companyName = companyDisplay(raw.company, raw.company_id);
  const jobName = asString(raw.name || raw.order_name);
  const facts = {
    ...lite,
    company: companyName || null,
    c_code: extractCCode(companyName),
    job_name: jobName || null,
    subtotal: money(raw.subtotal),
    tax: money(raw.tax),
    shipping: money(raw.shipping),
  };

  return {
    entity: "invoice" as const,
    summary: [
      lite.invoice_id != null ? `Invoice ${lite.invoice_id}` : "Invoice",
      lite.order_id != null ? `Order #${lite.order_id}` : null,
      companyName,
      lite.total,
      lite.payment_state,
    ]
      .filter(Boolean)
      .join(" · "),
    facts,
    reading_tips: [
      "UI invoice list # often means related Order # (order_id), not always invoice_id.",
      "balance_due = total - paid.",
    ],
  };
}

export function understandPayment(raw: Dict) {
  const companyName = companyDisplay(raw.company, raw.company_id);
  const amount = money(raw.amount);
  const facts = {
    transaction_id: raw.transaction_id ?? raw.id,
    company_id: raw.company_id ?? null,
    company: companyName || null,
    c_code: extractCCode(companyName),
    contact_id: raw.contact_id ?? null,
    amount,
    type: asString(raw.transaction_type) || null,
    date: day(raw.transaction_date || raw.createddate),
    ref_num: asString(raw.ref_num) || null,
    memo: asString(raw.memo) || null,
    bounced: raw.bounced === true || raw.bounced === 1 || raw.bounced === "1",
    exported: raw.exported === true || raw.exported === 1 || raw.exported === "1",
  };

  return {
    entity: "payment" as const,
    summary: [
      facts.transaction_id != null ? `Payment #${facts.transaction_id}` : "Payment",
      companyName,
      amount,
      facts.type,
      facts.date,
      facts.bounced ? "BOUNCED" : null,
    ]
      .filter(Boolean)
      .join(" · "),
    facts,
  };
}

export function understandOrderListRow(raw: Dict) {
  const view = understandOrder(raw);
  return {
    summary: view.summary,
    facts: {
      order_number: view.facts.order_number,
      job_name: view.facts.job_name,
      status: view.facts.status,
      order_type: view.facts.order_type,
      company_id: view.facts.company_id,
      company: view.facts.company,
      contact_id: view.facts.contact_id,
      ship_date: view.facts.ship_date,
      amount: view.facts.amount,
      payment_state: view.facts.payment_state,
    },
  };
}

export function understandCompanyListRow(raw: Dict) {
  const view = understandCompany(raw);
  return {
    summary: view.summary,
    facts: {
      company_id: view.facts.company_id,
      company: view.facts.company,
      c_code: view.facts.c_code,
      status: view.facts.status,
      email: view.facts.email,
      role: view.facts.role,
      payment_terms: view.facts.payment_terms,
    },
  };
}

export function understandContactListRow(raw: Dict) {
  const view = understandContact(raw);
  return { summary: view.summary, facts: view.facts };
}

export function understandInvoiceListRow(raw: Dict) {
  const view = understandInvoice(raw);
  return { summary: view.summary, facts: view.facts };
}

export function understandPaymentListRow(raw: Dict) {
  const view = understandPayment(raw);
  return { summary: view.summary, facts: view.facts };
}

export function understandStatusCounts(raw: unknown) {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Dict)
      : {};
  const nested =
    source.counts && typeof source.counts === "object"
      ? (source.counts as Dict)
      : source;

  const by_status: Record<string, number> = {};
  let total = 0;
  for (const [key, value] of Object.entries(nested)) {
    if (key === "total" || key === "counts") continue;
    const n = asNumber(value);
    if (n == null) continue;
    const label = labelOrderStatus(key) || key;
    by_status[label] = n;
    total += n;
  }

  return {
    entity: "order_status_counts" as const,
    summary: `Orders by status · ${total.toLocaleString("en-US")} total`,
    total,
    by_status,
    reading_tips: [
      "These are live Allmoxy counts across the instance, not a page of search results.",
      "Use this for portfolio questions instead of paging every order.",
    ],
  };
}
