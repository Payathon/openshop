import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { Buyer } from "@openshop/client/buyer";
import { createMcpServer } from "@openshop/client/mcp";
import { MODULES, productInputSchema, TEMPLATES, type OrderStatus } from "@openshop/core";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Accounts, SESSION_TTL_MS } from "./accounts.ts";
import { opInputSchema, type OpInput } from "./content.ts";
import { FakePaymentProvider } from "./payments/fake.ts";
import type { PaymentProvider } from "./payments/provider.ts";
import { loginSchema, newOrderSchema, newShopSchema, onboardSchema, registerSchema, scheduleSchema } from "./schemas.ts";
import { OpenShop, ShopError } from "./shop.ts";
import { LocalDiskStorage, MAX_IMAGE_BYTES, newImageKey, sniffImage, type Storage } from "./storage.ts";
import { Studio } from "./studio.ts";
import { shopSite } from "./web/site.tsx";

type Env = { Variables: { shopId: string } };

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const json = await c.req.json().catch(() => {
    throw new ShopError(400, "invalid_json", "请求体必须是 JSON");
  });
  const r = schema.safeParse(json);
  if (!r.success) throw new ShopError(400, "invalid_request", z.prettifyError(r.error));
  return r.data;
}

const orderStatuses = ["pending_payment", "confirmed", "paid", "shipped", "completed", "cancelled", "expired"] as const;

// previewSecret signs merchants' preview links; set it (PREVIEW_SECRET) so links survive restarts.
export function createApp(
  shop: OpenShop,
  payments: PaymentProvider,
  opts: { storage?: Storage; previewSecret?: string | undefined } = {},
) {
  const app = new Hono<Env>();
  const { storage } = opts;
  const studio = new Studio(shop, opts);
  const accounts = new Accounts(shop.db, () => shop.now());

  // The workbench's login: an HttpOnly session cookie for the whole origin.
  const SESSION_COOKIE = "os_session";
  const secure = shop.baseUrl.startsWith("https:");
  const startSession = (c: Context, token: string) =>
    setCookie(c, SESSION_COOKIE, token, { path: "/", httpOnly: true, sameSite: "Lax", secure, maxAge: SESSION_TTL_MS / 1000 });
  const sessionAccount = async (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE);
    return token ? accounts.fromSession(token) : null;
  };

  app.onError((err, c) => {
    if (err instanceof ShopError) return c.json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return c.json({ error: "internal", message: "服务器内部错误" }, 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true, payments: payments.name }));

  // ---- storefront: what the web page and customers' agents use ------------

  // A blank draft shop. Merchants normally start from /api/onboarding instead.
  app.post("/api/shops", async (c) => c.json(await shop.createShop(await body(c, newShopSchema)), 201));
  // Signed in, the new shop belongs to the account (one shop per account for now). Without a
  // session it is an API-only shop reached with the returned merchant token.
  app.post("/api/onboarding", async (c) => {
    const input = await body(c, onboardSchema);
    const account = await sessionAccount(c);
    if (account && (await accounts.shopsOf(account.id)).length > 0) throw new ShopError(409, "has_shop", "这个账号已经有一家店了");
    const created = await studio.onboard(input);
    if (account) await accounts.addOwner(account.id, created.shop.id);
    return c.json(created, 201);
  });
  app.get("/api/templates", (c) =>
    c.json({
      industries: Object.values(TEMPLATES).map((t) => ({ key: t.key, label: t.label, modules: t.modules })),
      modules: MODULES,
    }),
  );

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

  // ---- shop websites: server-rendered pages for customers' browsers -------

  app.route("/s/:slug", shopSite(shop, studio));

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

  // ---- merchant accounts ----------------------------------------------------

  app.post("/api/auth/register", async (c) => {
    const { account, session } = await accounts.register(await body(c, registerSchema));
    startSession(c, session);
    return c.json({ account }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    const { email, password } = await body(c, loginSchema);
    const { account, session } = await accounts.login(email, password);
    startSession(c, session);
    return c.json({ account });
  });

  app.post("/api/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await accounts.logout(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", async (c) => {
    const account = await sessionAccount(c);
    if (!account) throw new ShopError(401, "unauthorized", "请先登录");
    const [first] = await accounts.shopsOf(account.id);
    const overview = first ? await studio.overview(first.id) : null;
    return c.json({
      account,
      shop: overview && {
        id: overview.shop.id,
        slug: overview.shop.slug,
        name: overview.shop.name,
        industry: overview.shop.industry,
        status: overview.shop.status,
        url: overview.shop.url,
      },
    });
  });

  // ---- merchant: the workbench session, or the bearer token from shop creation ----------

  app.use("/api/merchant/*", async (c, next) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    let shopId = token ? await shop.authenticate(token) : null;
    if (!shopId && !token) {
      const account = await sessionAccount(c);
      shopId = account ? ((await accounts.shopsOf(account.id))[0]?.id ?? null) : null;
    }
    if (!shopId) throw new ShopError(401, "unauthorized", "请先登录");
    c.set("shopId", shopId);
    await next();
  });

  // Content edits (docs/tech-plan.md, 预览与发布) wait in the shop's changeset: they show in
  // previews at once and go live on publish. /changes takes any op from content.ts; this is
  // what the merchant agent's tools will call. The product routes are shorthands for it.

  app.get("/api/merchant/shop", async (c) => c.json(await studio.overview(c.get("shopId"))));
  app.get("/api/merchant/changes", async (c) => c.json(await studio.changes(c.get("shopId"))));
  app.post("/api/merchant/changes", async (c) => c.json(await studio.propose(c.get("shopId"), await body(c, opInputSchema)), 201));
  app.delete("/api/merchant/changes/:id", async (c) => c.json(await studio.undo(c.get("shopId"), c.req.param("id"))));
  app.delete("/api/merchant/changes", async (c) => {
    await studio.discard(c.get("shopId"));
    return c.body(null, 204);
  });
  app.post("/api/merchant/preview-link", async (c) => c.json(await studio.previewLink(c.get("shopId")), 201));
  app.post("/api/merchant/publish", async (c) => c.json(await studio.publish(c.get("shopId"))));
  app.get("/api/merchant/publishes", async (c) => c.json(await studio.publishHistory(c.get("shopId"))));
  app.post("/api/merchant/publishes/:version/rollback", async (c) => {
    const version = Number(c.req.param("version"));
    if (!Number.isInteger(version) || version < 1) throw new ShopError(400, "invalid_request", "版本号不正确");
    return c.json(await studio.rollback(c.get("shopId"), version));
  });

  const productEdit = async (c: Context<Env>, input: OpInput) => {
    const { change, product } = await studio.propose(c.get("shopId"), input);
    return { ...product, change };
  };
  app.post("/api/merchant/products", async (c) => c.json(await productEdit(c, { kind: "product.create", product: await body(c, productInputSchema) }), 201));
  app.put("/api/merchant/products/:id", async (c) =>
    c.json(await productEdit(c, { kind: "product.update", id: c.req.param("id"), product: await body(c, productInputSchema) })),
  );
  app.delete("/api/merchant/products/:id", async (c) => c.json(await studio.propose(c.get("shopId"), { kind: "product.delete", id: c.req.param("id") })));

  // Operational changes take effect immediately.

  app.get("/api/merchant/closures", async (c) => c.json(await studio.closures(c.get("shopId"))));
  app.put("/api/merchant/closures", async (c) => {
    const { closures } = await body(c, z.object({ closures: scheduleSchema.shape.closures }));
    return c.json(await studio.setClosures(c.get("shopId"), closures));
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

  app.get("/api/merchant/orders/:id", async (c) => c.json(await shop.merchantOrder(c.get("shopId"), c.req.param("id"))));

  app.post("/api/merchant/orders/:id/cancel", async (c) => c.json(await shop.merchantCancelOrder(c.get("shopId"), c.req.param("id"))));
  app.post("/api/merchant/orders/:id/complete", async (c) => c.json(await shop.completeOrder(c.get("shopId"), c.req.param("id"))));

  app.post("/api/merchant/orders/:id/ship", async (c) => {
    const { trackingNo } = await body(c, z.object({ trackingNo: z.string().min(1).max(50) }));
    return c.json(await shop.shipOrder(c.get("shopId"), c.req.param("id"), trackingNo));
  });

  app.get("/api/merchant/customers", async (c) => c.json(await shop.listCustomers(c.get("shopId"))));

  // ---- uploads ------------------------------------------------------------
  // The raw image is the request body (curl --data-binary @a.jpg -H 'content-type: image/jpeg'),
  // which an agent or the workbench can send without multipart encoding.

  if (storage) {
    app.post(
      "/api/merchant/uploads",
      bodyLimit({
        maxSize: MAX_IMAGE_BYTES,
        onError: () => {
          throw new ShopError(413, "too_large", `图片不能超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
        },
      }),
      async (c) => {
        const data = new Uint8Array(await c.req.arrayBuffer());
        const type = sniffImage(data);
        if (!type) throw new ShopError(415, "unsupported_type", "只支持 JPG、PNG、WebP、GIF 图片");
        const key = newImageKey(c.get("shopId"), type);
        await storage.put(key, data, type);
        return c.json({ key, url: storage.url(key) }, 201);
      },
    );
  }

  if (storage instanceof LocalDiskStorage) {
    app.get("/files/*", async (c) => {
      const file = await storage.read(c.req.path.slice("/files/".length));
      if (!file) return c.text("not found", 404);
      return c.body(file.data, 200, {
        "content-type": file.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      });
    });
  }

  // ---- dev: fake cashier --------------------------------------------------

  if (payments instanceof FakePaymentProvider) {
    app.get("/dev/fake-pay/:orderId", (c) => {
      const p = payments.get(c.req.param("orderId"));
      if (!p) return c.html(cashierPage("找不到这笔付款", `<p class="muted">链接可能已经失效。</p>`), 404);
      const amount = (p.amountFen / 100).toFixed(2);
      const body =
        `<p class="muted">${escapeHtml(p.subject)}</p><p class="amount"><small>¥</small>${amount}</p>` +
        (p.state === "pending"
          ? `<form method="post"><button>确认付款</button></form>`
          : `<p class="state">${p.state === "paid" ? "已付款" : "这笔付款已关闭"}</p>`);
      return c.html(cashierPage("支付宝收银台", body));
    });
    app.post("/dev/fake-pay/:orderId", (c) => {
      const orderId = c.req.param("orderId");
      if (!payments.complete(orderId)) return c.html(cashierPage("付款已关闭", `<p class="muted">订单已经超时或取消，请回到店铺重新下单。</p>`), 409);
      // Like Alipay's return_url: web orders go back to the shop's order page.
      const returnUrl = payments.get(orderId)?.returnUrl;
      if (returnUrl) return c.redirect(returnUrl, 303);
      return c.html(cashierPage("付款成功", `<p class="ok">✓</p><p>付款成功。回到和 AI 助手的对话，告诉它“付好了”。</p>`));
    });
  }

  return app;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// The local stand-in for Alipay's cashier. Clearly marked as a test so nobody mistakes it.
const cashierPage = (title: string, body: string) =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<link rel="icon" href="data:,"><title>${title}</title><style>` +
  `body{margin:0;background:#f5f6f7;font:15px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#1a1a1a}` +
  `header{background:#1677ff;color:#fff;padding:14px 16px;font-weight:600;display:flex;align-items:center;gap:8px}` +
  `header span{margin-left:auto;font-size:12px;font-weight:500;background:rgba(255,255,255,.2);padding:2px 8px;border-radius:999px}` +
  `main{max-width:420px;margin:24px auto;padding:0 16px}` +
  `.card{background:#fff;border-radius:12px;padding:24px 20px;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.05)}` +
  `.muted{color:#666;margin:0}.amount{font-size:40px;font-weight:600;margin:12px 0 24px}.amount small{font-size:22px;margin-right:2px}` +
  `button{width:100%;height:48px;border:none;border-radius:10px;background:#1677ff;color:#fff;font-size:17px;font-weight:600;cursor:pointer}` +
  `.state{color:#666}.ok{font-size:44px;color:#1677ff;margin:0}.note{text-align:center;color:#999;font-size:12px;margin-top:16px}` +
  `</style><header>支付宝<span>模拟收银台</span></header><main><div class="card">${body}</div>` +
  `<p class="note">本地测试用，不会真的扣款</p></main></html>`;
