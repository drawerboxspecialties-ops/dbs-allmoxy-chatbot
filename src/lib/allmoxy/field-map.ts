/**
 * DBS Allmoxy UI ↔ API field map
 * Learned read-only from dbs.allmoxy.com (Orders, Companies, Invoices).
 * Use this so the chatbot speaks in staff language and queries the right API fields.
 */
export const ALLMOXY_FIELD_MAP = `
## DBS Allmoxy field map (UI language → API)

### Orders (Orders list + Order detail)
- UI "ORDER #" / "Order #603051" → API order_id (integer). This is what staff usually mean by "order number".
- UI "NAME" / "Order Name" (e.g. Ross, 26164A, 072226, Quote) → API name. Job name / customer PO-style label — NOT the Allmoxy order number.
- UI "COMPANY" (e.g. Tony Cooper - C004321) → API company_id + related company.name; the "C######" suffix is a DBS customer account code shown in the company display name.
- UI "#" (item count on list) → quantity/total items on the order (related to products), not order_id.
- UI "SHIP DATE" → requested/actual ship timing; API desired_delivery_date / actual_delivery_date / finish-related ship fields.
- UI "STATUS" pills → API status values (case may vary): Bid, Ordered, Verified, In Progress, On Hold, Completed, Shipped, Void.
- UI search "Name or order Number" → if digits only, treat as order_id; otherwise search name.
- Order money: UI Subtotal/Tax/Shipping/Total → API price / invoice.subtotal / invoice.tax / invoice.shipping / invoice.total (invoice related_objects).
- Example: order_id 603051 has name "Ross"; order_id 603045 has name "26164A".

### Companies / Customers (Company List)
- UI company title "A & J All Woodwork - C009347" → API companies.name (often includes C-code) and company_id.
- UI contact person under company → contacts linked by company_id.
- UI email → companies.email or contact email.
- Roles filter Customers/Vendors/Others → company role filters.
- Status Active/Inactive → API status 1/0.

### Contacts (people)
- contact_id → person record.
- first_name / last_name / email / job_title → person fields.
- company_id → which customer/company they belong to.
- Employees vs customers: contact_type / can_log_in style flags.

### Invoices (Financial → Invoices)
- UI "#" on invoice list often links to the related order number (order_id).
- UI "CUSTOMER" → company (name + C-code).
- UI "NAME" → job/order name label.
- UI "TYPE" → invoice_type (order, credit memo, finance charge, cc fee, other, bounced payment).
- UI "DATE" → invoice_date / createddate.
- UI "AMOUNT" → invoice.total.
- API paid → amount already paid; balance conceptually total - paid.
- Filter "Name or order Number" → same rule as orders: digits ⇒ order_id, else name.

### Payments / Transactions (Payment Receipts)
- UI "ID" → API transaction_id.
- UI "COMPANY NAME" → company (often with C-code).
- UI "TRANSACTION DATE" → transaction_date.
- UI "TRANSACTION TYPE" → transaction_type (cc, check, credit, manual; UI may show "Manual (Credit card)").
- UI "AMOUNT" → amount.
- company_id / contact_id → who paid.
- ref_num / memo → check ref / notes.

### Statements
- UI lists companies with overdue invoices (not a separate API "statement" entity).
- Use company + invoices (total vs paid) to reason about outstanding balances.

### Supplies / Purchase Orders (UI only for now; limited API in chat)
- Supplies: ITEM NAME, PART NUMBER, PIECE SIZE, QTY ON HAND; locations Side/Bottom/Raw/Hardware/Finished.
- POs: PO #, Date Ordered, Date Received, Company, Total.

### Lookup rules for the assistant
1. Pure number like 603051 ⇒ order_id via findOrder/getOrder.
2. Text like Ross / 26164A ⇒ order name search.
3. "C004321" or "Tony Cooper - C004321" ⇒ getCompanySnapshot / company name search.
4. Never tell staff that name is the order number; say "Order #603051 named Ross".
5. Prefer staff wording: Order #, Company, Job/PO name, Ship date, Status, Invoice amount, Paid.

### How to read tool data (important)
Tools return *understood* objects, not raw Allmoxy dumps:
- summary: one-line operational headline — safe to quote.
- facts: labeled fields already mapped to UI language (status titles, money, dates, C-code).
- reading_tips: hints about blanks/nulls (e.g. actual ship date missing).
- List tools: entries[] each have summary + facts; also total_entries / total_pages.
- Nested related data is pre-flattened: invoices[], line_items[], status_history[].
- payment_state is computed: Unpaid | Partial | Paid from total vs paid.
- balance_due = total - paid (never invent a different formula).
- Null / missing fields mean "not set in Allmoxy" — say unknown/not set, do not guess.
- If a tool returns zero matches or an error, tell the user that. Never fabricate an order, company, balance, or date.
- Company grace_period: 0 ⇒ COD; >0 ⇒ Net X on account (even if payment_options is null).
`;
