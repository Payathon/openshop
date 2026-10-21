import { z } from "zod";

// Request bodies shared by the JSON API and the web checkout.

export const phone = z.string().regex(/^1\d{10}$/, "手机号格式不正确");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);

export const scheduleSchema = z.object({
  weekly: z.array(z.object({ weekday: z.number().int().min(0).max(6), open: hhmm, close: hhmm })),
  capacity: z.number().int().positive(),
  stepMinutes: z.number().int().positive().default(30),
  closures: z.array(z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) })).default([]),
});

const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "店铺地址只能用小写字母、数字和连字符，3–40 位");

// Opening a shop from an industry template (product-decisions #6). Without a slug, one is generated.
export const onboardSchema = z.object({
  industry: z.string(),
  modules: z.array(z.enum(["booking", "shopping", "banner", "gallery", "text"])).optional(),
  name: z.string().min(1).max(50),
  phone,
  address: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  slug: slug.optional(),
});

export const newShopSchema = z.object({
  slug,
  name: z.string().min(1).max(50),
  industry: z.string().min(1).max(30),
  description: z.string().max(2000).optional(),
  phone,
  address: z.string().max(200).optional(),
  schedule: scheduleSchema.optional(),
  cancelPolicy: z.object({ freeCancelHoursBefore: z.number().int().nonnegative() }).optional(),
});

export const addressSchema = z.object({
  recipient: z.string().min(1).max(30),
  phone,
  region: z.string().min(1).max(100),
  detail: z.string().min(1).max(200),
});

export const newOrderSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string(),
        quantity: z.number().int().positive().max(99).optional(),
        options: z.record(z.string(), z.string()).optional(),
      }),
    )
    .min(1),
  customer: z.object({ name: z.string().min(1).max(30), phone }),
  slotStart: z.iso.datetime({ offset: true }).optional(),
  address: addressSchema.optional(),
  source: z.enum(["web", "agent"]).optional(),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, "请填写称呼").max(30),
  email: z.email("邮箱格式不正确").max(200),
  password: z.string().min(8, "密码至少 8 位").max(200),
});

export const loginSchema = z.object({ email: z.string().max(200), password: z.string().max(200) });
