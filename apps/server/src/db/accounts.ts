import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { shops } from "./schema.ts";

// Merchant accounts for the workbench. Email and password for now; Alipay login comes with M5
// and will attach to the same account rows. An account reaches its shops through memberships,
// so staff accounts can be added later without touching shops.

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // scrypt, "salt:hash" in hex.
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_account_idx").on(t.accountId)],
);

export const memberships = pgTable(
  "memberships",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    role: text("role").$type<"owner">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.shopId] }), index("memberships_shop_idx").on(t.shopId)],
);
