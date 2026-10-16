import type { BookingSchedule, CancelPolicy, Fulfillment, OrderOption, OrderStatus } from "@openshop/core";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Every shop shares these tables, keyed by shop_id. Agents write rows, never DDL (docs/tech-plan.md).

// Closures are stored as ISO strings; the service converts them to Dates.
export type StoredSchedule = Omit<BookingSchedule, "closures"> & { closures: { start: string; end: string }[] };

export interface Address {
  recipient: string;
  phone: string;
  region: string;
  detail: string;
}

export const shops = pgTable("shops", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  description: text("description").notNull().default(""),
  phone: text("phone").notNull(),
  address: text("address"),
  schedule: jsonb("schedule").$type<StoredSchedule | null>(),
  cancelPolicy: jsonb("cancel_policy").$type<CancelPolicy>().notNull(),
  merchantTokenHash: text("merchant_token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id").notNull().references(() => shops.id),
    name: text("name").notNull(),
    description: text("description").notNull(),
    images: jsonb("images").$type<string[]>().notNull(),
    fulfillment: text("fulfillment").$type<Fulfillment>().notNull(),
    durationMinutes: integer("duration_minutes"),
    orderOptions: jsonb("order_options").$type<OrderOption[]>().notNull(),
    info: jsonb("info").$type<{ label: string; value: string }[]>().notNull(),
    published: boolean("published").notNull(),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("products_shop_idx").on(t.shopId)],
);

export const variants = pgTable(
  "variants",
  {
    id: text("id").primaryKey(),
    productId: text("product_id").notNull().references(() => products.id),
    shopId: text("shop_id").notNull().references(() => shops.id),
    position: integer("position").notNull(),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull(),
    priceFen: integer("price_fen").notNull(),
    // Null for booking products, whose capacity is shop-wide.
    stock: integer("stock"),
    deleted: boolean("deleted").notNull().default(false),
  },
  (t) => [index("variants_product_idx").on(t.productId)],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id").notNull().references(() => shops.id),
    status: text("status").$type<OrderStatus>().notNull(),
    fulfillment: text("fulfillment").$type<Fulfillment>().notNull(),
    // "web" or "agent", shown to the merchant as 来自 AI.
    source: text("source").notNull(),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(),
    address: jsonb("address").$type<Address | null>(),
    slotStart: timestamp("slot_start", { withTimezone: true }),
    slotEnd: timestamp("slot_end", { withTimezone: true }),
    totalFen: integer("total_fen").notNull(),
    // Lets the customer (or their agent) read and cancel this one order without an account.
    accessTokenHash: text("access_token_hash").notNull(),
    paymentUrl: text("payment_url"),
    paymentExpiresAt: timestamp("payment_expires_at", { withTimezone: true }).notNull(),
    refunded: boolean("refunded").notNull().default(false),
    trackingNo: text("tracking_no"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [index("orders_shop_status_idx").on(t.shopId, t.status)],
);

export const orderItems = pgTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  productId: text("product_id").notNull().references(() => products.id),
  variantId: text("variant_id").notNull().references(() => variants.id),
  // Snapshots, so later edits don't rewrite history.
  productName: text("product_name").notNull(),
  attributes: jsonb("attributes").$type<Record<string, string>>().notNull(),
  options: jsonb("options").$type<Record<string, string>>().notNull(),
  quantity: integer("quantity").notNull(),
  unitFen: integer("unit_fen").notNull(),
});

// Each shop's own customer list, built from paid orders. There are no customer accounts.
export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id").notNull().references(() => shops.id),
    phone: text("phone").notNull(),
    name: text("name").notNull(),
    orderCount: integer("order_count").notNull(),
    totalFen: integer("total_fen").notNull(),
    firstOrderAt: timestamp("first_order_at", { withTimezone: true }).notNull(),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("customers_shop_phone_idx").on(t.shopId, t.phone)],
);
