/**
 * Complete read-only map of DBS Allmoxy (dbs.allmoxy.com).
 * Explored as Kowshik Vasu — no creates/updates/deletes performed.
 * Instance version observed: v1.5.60-Production.
 */
export const ALLMOXY_SITE_MAP = `
## What Allmoxy is (DBS)
Allmoxy is DBS's ERP/MES/CRM for custom drawer manufacturing:
configure quotes/orders → produce (cut sheets, scans, labor) → ship → invoice → collect payments.
Instance: dbs.allmoxy.com. Staff home lands on Time Card + tasks/notes for the logged-in contact.

## Site navigation (main menu)

### Home
- /home/time_card/ — personal profile, Clock In, Time Card / Time Tracking, My Tasks, Notes, Tags
- My Profile also: Scanning Station, Timecard Scanner

### Add (quick create — do not use in ops chat)
Order, Itemized Order, Company, Company Contacts, Individual Accounts, Supply, Credit Memo, Note, Task, Announcement

### Orders
- /orders/ — master order list
- /orders/new/ — Add Order (configured product quote)
- /orders/new/quote/ — Add Itemized Order
- /orders/import/ — Import Order
- /orders/batch/ — Batch Orders
- /orders/{id}/ or /orders/quote/{id}/ — order editor (redirects to quote editor)

### Contacts (CRM)
- /accounts/companies/ — Company List
- /accounts/companies/{id}/ — Company dashboard
- /accounts/contacts/ — Company Contacts (people)
- /accounts/individual/ — Individual Accounts
- /accounts/contacts/update/ — Contact Updater

### Supplies (inventory / purchasing)
- /inventory/ — Supplies List
- /inventory/purchase_orders/ — Purchase Orders
- /inventory/batches/ — PO Batches
- /inventory/update/ — Supply Updater
- /inventory/processing/ — Checkout/Order
- /export/purchase_orders/ — Export PO Queue

### Financial
- /invoices/ (also /financial/invoices/) — Invoices
- /statements/ — companies with overdue balances → printable statements
- /payments/ — Payment Receipts (transactions)
- /invoices/batches/ — Invoice Batches
- /invoices/new/ — New Credit Memo
- /hr/timeclock/ — Timecard Management
- Export queues: invoices, sales_orders, credits, payments

### Reports
Financial: Aging, Average Payment Days, Collections, Employee Timecards, Invoices, Material Cost by Customer/Product, Purchase Orders, Remote Receipts, Sales by Attribute/Customer/Export Class/Product/(Product+Attribute), Sales Tax, Transaction History
Production: Allocated Supplies, Customer Product History, Employee Productivity, Notes Per Employee, Orders, Process Details, Production, Products by Status, Remakes, Resource Allocation, Status Volume, Schedule Capacity, Shipping, Status History, Supplies in Use, Supply Movement, Work Schedule, Work Summary
Managerial: Activity Logs, Current Inventory, Email Logs, Inventory in Use/Usage, Order Results Comparison, Projection, Received Supplies, Tasks, Time Tracking

### Marketplace
- /marketplace/ — partner/reseller marketplace

### Settings
E-commerce / catalog: Order Settings, Categories, Product Attributes, Products, Proxy Variable Categories/Variables, Components, Output Pages, Marketplace, B2B Settings, B2B Catalog, Custom Fields, Exporters, Labor Processes, Price Adjustments, Shipping, Supply Locations, Triggers
Integrations: API, Messaging, Zapier
Utilities: Attribute Updater, Import, Import Product, Manage Tags, Merge Companies, Product Updater
Admin: Account Settings, Financial, Payment Methods, Theme

## Core business objects & UI columns

### Orders list (/orders/)
Columns: ORDER # | COMPANY | NAME | # (item count) | SHIP DATE | STATUS
Filters: Name or order Number, Export Class, Status checkboxes, Tags
Statuses: Bid, Ordered, Verified, In Progress, On Hold, Completed, Shipped, Void
Default filter often excludes Shipped/Void.
Examples: 603056 Tony Cooper-C004321 name 072226 Bid; 603055 AMD name Quote In Progress.

### Order detail (/orders/quote/{order_id}/)
Title: "Edit Order: {Order Name}" + sidebar "Order #{order_id}"
Tabs/areas: Order | Production | Timeline | All Lines | Scans | Resource Allocation
Output pages: Quote, Top/Parts/Bottom Cut Sheets, Invoice (±Metric), Shipper (±Metric), Label, Results, Order Override
Order Info: Status, Order Name*, For (company), Contact, Description, Requested Ship Date, Actual Ship Date
Billing/Shipping addresses, Shipping Instructions, Attachments, Tasks, Notes, Tags
Configured product lines (DBS drawers): Side Material, Top Edge, Corner Construction, Bottom Material/Construction, Notch & Drill, Clips, Laser Logo, Scoop, Slope, Support Strip, Inserts, Dividers, Drill Front, File Slots, Qty/Width/Depth/Height, Price
Totals: Discount %, Subtotal, Tax (e.g. 8.750%), GST/PST, Shipping, Total Items, Total Weight, Total USD
Example 603051 "Ross": status in progress, subtotal $344.39, tax $30.13, ship $30, total $404.52, 9 items, 58.86 lb, ship-to Home Cabinets Temecula CA

### Companies (/accounts/companies/)
Columns: COMPANY NAME | PRIMARY CONTACT | PHONE # | E-MAIL
Filters: Company Name or Email, Status Active/Inactive, Customers/Vendors/Others, Logos, Address type/country/state, Tags
Display name often "Company - C######" (DBS customer code). Tags include pricing levels (Baltic Birch Level A–D), regions (SoCal-North, Norcal), discounts.

### Company dashboard (/accounts/companies/{id}/)
Header: company name + role (Customer/Vendor)
Sections: Outstanding Invoices, Orders (by status + Show Buying History), Contacts, Notes, Tasks, Tags, Quick Links, Create New Order
Example: A & J All Woodwork - C009347, tag SoCal-North

### Contacts (/accounts/contacts/)
Columns: NAME | JOB TITLE | COMPANY | PHONE | E-MAIL
Filters: Company/Contact/Email, Customers/Vendors/Others, can log in, disabled flags, Images, Country/State

### Invoices
Columns: # (often order_id link) | CUSTOMER | NAME | TYPE | DATE | AMOUNT
Types: Orders, Credit memos, Finance Charges, CC Fees, Other Charges, Bounced Payments
Filter: Invoice Date, Name or order Number, type checkboxes, Tags

### Payment Receipts (/payments/)
Columns: ID | COMPANY NAME | TRANSACTION DATE | TRANSACTION TYPE | AMOUNT
Types filter: Credit card (cc), Check, Credit Memo, Manual
ID ≈ transaction_id (e.g. 811 Precise Woodworks Manual CC $423.05)

### Statements (/statements/)
Companies with overdue invoices; filter by Company Name / Tags; used to print/mail statements.

### Supplies (/inventory/)
Columns: ITEM NAME | PART NUMBER | PIECE SIZE | QUANTITY ON HAND
Locations: Bottom Materials, Finished Goods, Hardware, Raw Materials, Side Materials, Unassigned
Filters: Supply Name, Sale Name, Part Number, Vendor, Catalog/B2B flags

### Purchase Orders (/inventory/purchase_orders/)
Columns: PO # | DATE ORDERED | DATE RECEIVED | COMPANY | TOTAL
Filter: Date Ordered, PO Number

### Products catalog (/catalog/products/)
Columns: PRODUCT NAME | STATUS (Active/Discontinued)
Sellable configured products (drawer side materials, etc.) — distinct from inventory Supplies.

## Cross-cutting concepts
- Tags: applied to companies/orders (pricing tiers, regions, materials). Filter everywhere.
- Notes / Tasks / Attachments / Announcements: collaboration on people, companies, orders.
- Export queues: staging for QuickBooks/accounting exporters.
- Scanning Station / Timecard Scanner: shop-floor production & labor capture.
- Global Search in header: quick find across entities.
- Send To: email/share list views.
- B2B / Marketplace: customer-facing catalog paths.

## Staff language cheat sheet
- "Order number / Order #" → order_id
- "Job name / PO / Name" → order.name
- "Customer / Company / C-code" → company (name often includes C######)
- "Ship date" → requested/actual ship dates
- "Status" → Bid…Shipped/Void
- "Invoice #" in list → often the order number link
- "Payment ID" → transaction_id
- "Outstanding" → unpaid invoice balance on company
- Never confuse order_id with order name.
`;
