import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { Buyer } from "@openshop/client/buyer";
import { createMcpServer } from "@openshop/client/mcp";
import { productInputSchema, type OrderStatus } from "@openshop/core";
import { FakePaymentProvider } from "./payments/fake.ts";
import type { PaymentProvider } from "./payments/provider.ts";
import { OpenShop, ShopError } from "./shop.ts";

type Env = { Variables: { shopId: string } };

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => {
    throw new ShopError(400, "invalid_json", "请求体必须是 JSON");
  });
  const r = schema.safeParse(json);
  if (!r.success) throw new ShopError(400, "invalid_request", z.prettifyError(r.error));
  return r.data;
}

const phone = z.string().regex(/^1\d{10}$/, "手机号格式不正确");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);

const scheduleSchema = z.object({
  weekly: z.array(z.object({ weekday: z.number().int().min(0).max(6), open: hhmm, close: hhmm })),
  capacity: z.number().int().positive(),
  stepMinutes: z.number().int().positive().default(30),
  closures: z.array(z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }) })).default([]),
});

const newShopSchema = z.object({
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "店铺地址只能用小写字母、数字和连字符，3–40 位"),
  name: z.string().min(1).max(50),
  industry: z.string().min(1).max(30),
  description: z.string().max(2000).optional(),
  phone,
  address: z.string().max(200).optional(),
  schedule: scheduleSchema.optional(),
  cancelPolicy: z.object({ freeCancelHoursBefore: z.number().int().nonnegative() }).optional(),
});

const addressSchema = z.object({
  recipient: z.string().min(1).max(30),
  phone,
  region: z.string().min(1).max(100),
  detail: z.string().min(1).max(200),
});

const newOrderSchema = z.object({
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

const orderStatuses = ["pending_payment", "confirmed", "paid", "shipped", "completed", "cancelled", "expired"] as const;

export function createApp(shop: OpenShop, payments: PaymentProvider) {
  const app = new Hono<Env>();

  app.onError((err, c) => {
    if (err instanceof ShopError) return c.json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return c.json({ error: "internal", message: "服务器内部错误" }, 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true, payments: payments.name }));

  // ---- storefront: what the web page and customers' agents use ------------

  app.post("/api/shops", async (c) => c.json(await shop.createShop(await body(c, newShopSchema)), 201));

  app.get("/api/s/:slug", async (c) => c.json(await shop.getShop(c.req.param("slug"))));
  app.get("/api/s/:slug/products", async (c) => c.json(await shop.listProducts(c.req.param("slug"))));
  app.get("/api/s/:slug/products/:id", async (c) => c.json(await shop.getProduct(c.req.param("slug"), c.req.param("id"))));

  app.get("/api/s/:slug/availability", async (c) => {
    const variantId = c.req.query("variantId");
    if (!variantId) throw new ShopError(400, "invalid_request", "需要 variantId 参数");
    return c.json(await shop.availability(c.req.param("slug"), variantId, c.req.query("date")));
  });

  app.post("/api/s/:slug/orders", async (c) => c.json(await shop.createOrder(c.req.param("slug"), await body(c, newOrderSchema)), 201));

  const orderToken = (c: Context) => c.req.header("x-order-token") ?? "";
  app.get("/api/orders/:id", async (c) => c.json(await shop.getOrder(c.req.param("id"), orderToken(c))));
  app.post("/api/orders/:id/cancel", async (c) => c.json(await shop.cancelOrder(c.req.param("id"), orderToken(c))));

  // ---- remote MCP: the storefront tools for customers' agents ---------------
  // Public like the storefront itself. Stateless: each request gets its own server, and tools
  // call this app in-process. Without local storage, the agent keeps each order's access token.

  app.all("/mcp", async (c) => {
    const buyer = new Buyer({
      server: "http://openshop.internal",
      fetch: (url, init) => Promise.resolve(app.fetch(new Request(url, init))),
      ownShopsOnly: true,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await createMcpServer(buyer).connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // ---- merchant: bearer token from shop creation --------------------------

  app.use("/api/merchant/*", async (c, next) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const shopId = token ? await shop.authenticate(token) : null;
    if (!shopId) throw new ShopError(401, "unauthorized", "需要商家令牌");
    c.set("shopId", shopId);
    await next();
  });

  app.post("/api/merchant/products", async (c) => c.json(await shop.createProduct(c.get("shopId"), await body(c, productInputSchema)), 201));
  app.put("/api/merchant/products/:id", async (c) =>
    c.json(await shop.updateProduct(c.get("shopId"), c.req.param("id"), await body(c, productInputSchema))),
  );
  app.delete("/api/merchant/products/:id", async (c) => {
    await shop.deleteProduct(c.get("shopId"), c.req.param("id"));
    return c.body(null, 204);
  });

  app.put("/api/merchant/variants/:id/stock", async (c) => {
    const { stock } = await body(c, z.object({ stock: z.number().int().nonnegative() }));
    return c.json(await shop.setStock(c.get("shopId"), c.req.param("id"), stock));
  });

  app.get("/api/merchant/orders", async (c) => {
    const status = c.req.query("status");
    if (status && !(orderStatuses as readonly string[]).includes(status)) throw new ShopError(400, "invalid_request", `未知的订单状态 ${status}`);
    return c.json(await shop.listOrders(c.get("shopId"), status as OrderStatus | undefined));
  });

  app.post("/api/merchant/orders/:id/ship", async (c) => {
    const { trackingNo } = await body(c, z.object({ trackingNo: z.string().min(1).max(50) }));
    return c.json(await shop.shipOrder(c.get("shopId"), c.req.param("id"), trackingNo));
  });

  app.get("/api/merchant/customers", async (c) => c.json(await shop.listCustomers(c.get("shopId"))));

  // ---- dev: fake cashier --------------------------------------------------

  if (payments instanceof FakePaymentProvider) {
    app.get("/dev/fake-pay/:orderId", (c) => {
      const p = payments.get(c.req.param("orderId"));
      if (!p) return c.text("unknown payment", 404);
      const yuan = (p.amountFen / 100).toFixed(2);
      return c.html(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
          `<title>模拟支付</title><body style="font-family:system-ui;max-width:420px;margin:48px auto;padding:0 16px">` +
          `<h1>模拟支付宝收银台</h1><p>${escapeHtml(p.subject)}</p><p style="font-size:28px">¥${yuan}</p>` +
          (p.state === "pending"
            ? `<form method="post"><button style="font-size:18px;padding:10px 24px">确认付款</button></form>`
            : `<p>状态：${p.state === "paid" ? "已付款" : "已关闭"}</p>`),
      );
    });
    app.post("/dev/fake-pay/:orderId", (c) => {
      const done = payments.complete(c.req.param("orderId"));
      return done ? c.html(`<!doctype html><meta charset="utf-8"><p>付款成功，可以回到对话或订单页面了。</p>`) : c.text("payment closed", 409);
    });
  }

  return app;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
