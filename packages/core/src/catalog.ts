import { z } from "zod";
import { imageUrl } from "./page.ts";

// A product is sold one of three ways; the fulfillment decides what an order must carry.
// booking: a time slot. shipping: a delivery address. pickup is planned but not built.
export const fulfillments = ["booking", "shipping"] as const;
export type Fulfillment = (typeof fulfillments)[number];

// Customer-specific custom fields follow Shopify's split (docs/product-decisions.md, 4b):
// variants carry their own price and stock; order options are asked at checkout and
// never change price; info is display-only.

export const orderOptionSchema = z.discriminatedUnion("type", [
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal("choice"),
    choices: z.array(z.string().min(1)).min(1),
    required: z.boolean(),
  }),
  z.object({ key: z.string().min(1), label: z.string().min(1), type: z.literal("text"), required: z.boolean() }),
]);
export type OrderOption = z.infer<typeof orderOptionSchema>;

export const infoFieldSchema = z.object({ label: z.string().min(1), value: z.string() });

export const variantInputSchema = z.object({
  // e.g. { 尺码: "M" }. Empty for the single default variant of a product without variants.
  attributes: z.record(z.string(), z.string()).default({}),
  priceFen: z.number().int().nonnegative(),
  // Shipping only; booking capacity is shop-wide.
  stock: z.number().int().nonnegative().nullable().default(null),
});

export const productInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(""),
  images: z.array(imageUrl).max(9).default([]),
  fulfillment: z.enum(fulfillments),
  durationMinutes: z.number().int().positive().nullable().default(null),
  orderOptions: z.array(orderOptionSchema).default([]),
  info: z.array(infoFieldSchema).default([]),
  variants: z.array(variantInputSchema).min(1),
  published: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export type OptionCheck = { ok: true; values: Record<string, string> } | { ok: false; error: string };

export function checkOptionValues(options: OrderOption[], given: Record<string, string>): OptionCheck {
  for (const key of Object.keys(given)) {
    if (!options.some((o) => o.key === key)) return { ok: false, error: `未知的下单选项：${key}` };
  }
  const values: Record<string, string> = {};
  for (const option of options) {
    const value = given[option.key]?.trim();
    if (!value) {
      if (option.required) return { ok: false, error: `缺少下单选项：${option.label}` };
      continue;
    }
    if (option.type === "choice" && !option.choices.includes(value)) {
      return { ok: false, error: `${option.label} 只能选择：${option.choices.join("、")}` };
    }
    values[option.key] = value;
  }
  return { ok: true, values };
}
