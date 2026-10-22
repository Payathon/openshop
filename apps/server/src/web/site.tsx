/** @jsxImportSource hono/jsx */
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import type { Child } from "hono/jsx";
import { z } from "zod";
import { cancellation, TERMINAL } from "@openshop/core";
import { newOrderSchema } from "../schemas.ts";
import { ShopError, type OpenShop } from "../shop.ts";
import type { Studio } from "../studio.ts";
import { llmsTxt, openshopJson, type ShopUrls } from "./discovery.ts";
import { NotFound, type PublicProduct, type PublicShop } from "./layout.tsx";
import { OrderPage } from "./order-page.tsx";
import { ProductPage } from "./product-page.tsx";
import { ShopPage } from "./shop-page.tsx";

// One shop's website, with paths relative to the shop root. app.ts mounts it at /s/:slug;
// a Host-based entry (slug.openshop.xx) would mount the same routes at / and set the slug.
// /preview/<token>/… serves the same pages from the merchant's unpublished content.

type Env = { Variables: { slug: string } };

// The order's access token lives in an HttpOnly cookie scoped to the shop, never in a URL,
// so it can't leak through logs, Referer or a shared screenshot of the address bar.
const orderCookie = (orderId: string) => `ost_${orderId}`;
const COOKIE_MAX_AGE = 30 * 86_400;

const FIELDS: Record<string, string> = {
  "customer.name": "称呼",
  "customer.phone": "手机号",
  "address.recipient": "收货人",
  "address.phone": "收货人手机号",
  "address.region": "所在地区",
  "address.detail": "详细地址",
  slotStart: "预约时间",
};

// The first problem in words a customer understands, instead of zod's report.
function readable(error: z.ZodError) {
  const issue = error.issues[0]!;
  if (/[一-龥]/.test(issue.message)) return issue.message;
  const field = FIELDS[issue.path.join(".")];
  return field ? `请检查${field}` : "下单信息有误，请检查后重试";
}

export function shopSite(shop: OpenShop, studio: Studio) {
  const site = new Hono<Env>();

  site.use(async (c, next) => {
    c.set("slug", c.req.param("slug") ?? "");
    await next();
  });

  const page = (c: Context, node: Child, status: 200 | 404 = 200) => c.html(html`<!doctype html>${node}`, status);

  site.onError((err, c) => {
    if (err instanceof ShopError && err.status === 404) return page(c, <NotFound message={err.message} />, 404);
    if (err instanceof ShopError) return c.text(err.message, err.status);
    console.error(err);
    return c.text("服务器出错了，请稍后再试", 500);
  });

  // The published shop, as customers see it.
  async function live(c: Context<Env>) {
    const slug = c.get("slug");
    const s = await shop.getShop(slug);
    const urls: ShopUrls = { shop: shop.shopUrl(slug), server: shop.baseUrl };
    return { shop: s, urls, page: await studio.livePage(s.id, !!s.schedule) };
  }

  // The merchant's unpublished content behind a signed link. Links inside stay in the preview.
  async function preview(c: Context<Env>) {
    const slug = c.get("slug");
    const token = c.req.param("token")!;
    const { row, content } = await studio.preview(slug, token);
    const s: PublicShop = {
      id: row.id,
      slug: row.slug,
      industry: row.industry,
      ...content.shop,
      schedule: content.shop.hours && { weekly: content.shop.hours.weekly, capacity: content.shop.hours.capacity },
    };
    const products: PublicProduct[] = content.products.filter((p) => p.published);
    const samples = new Set(content.products.filter((p) => p.sample).map((p) => p.id));
    const urls: ShopUrls = { shop: `${shop.shopUrl(slug)}/preview/${token}`, server: shop.baseUrl };
    c.header("cache-control", "no-store");
    return { shop: s, products, samples, urls, page: content.page };
  }

  site.get("/", async (c) => {
    const v = await live(c);
    const products = await shop.listProducts(v.shop.slug);
    return page(c, <ShopPage shop={v.shop} products={products} urls={v.urls} now={shop.now()} page={v.page} preview={null} />);
  });

  site.get("/p/:productId", async (c) => {
    const v = await live(c);
    const product = await shop.getProduct(v.shop.slug, c.req.param("productId"));
    return page(c, <ProductPage shop={v.shop} product={product} urls={v.urls} now={shop.now()} theme={v.page.theme} />);
  });

  site.get("/preview/:token", async (c) => {
    const v = await preview(c);
    return page(c, <ShopPage shop={v.shop} products={v.products} urls={v.urls} now={shop.now()} page={v.page} preview={{ samples: v.samples }} />);
  });

  site.get("/preview/:token/p/:productId", async (c) => {
    const v = await preview(c);
    const product = v.products.find((p) => p.id === c.req.param("productId"));
    if (!product) throw new ShopError(404, "product_not_found", "找不到这个商品");
    return page(
      c,
      <ProductPage shop={v.shop} product={product} urls={v.urls} now={shop.now()} theme={v.page.theme} preview={{ sample: v.samples.has(product.id) }} />,
    );
  });

  // The page's form posts here rather than to the JSON API so the token can go into a cookie.
  site.post("/checkout", async (c) => {
    const { shop: s, urls } = await live(c);
    const input = newOrderSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "invalid_request", message: readable(input.error) }, 400);
    try {
      const order = await shop.createOrder(s.slug, { ...input.data, source: "web" });
      setCookie(c, orderCookie(order.id), order.accessToken, {
        path: new URL(urls.shop).pathname,
        httpOnly: true,
        sameSite: "Lax",
        secure: urls.shop.startsWith("https:"),
        maxAge: COOKIE_MAX_AGE,
      });
      return c.json({ orderId: order.id, paymentUrl: order.paymentUrl, orderUrl: `${urls.shop}/orders/${order.id}` }, 201);
    } catch (err) {
      if (err instanceof ShopError) return c.json({ error: err.code, message: err.message }, err.status);
      throw err;
    }
  });

  async function customerOrder(c: Context<Env>) {
    const v = await live(c);
    const orderId = c.req.param("orderId")!;
    const token = getCookie(c, orderCookie(orderId));
    const missing = new ShopError(404, "order_not_found", "找不到这个订单。订单只能在下单时用的浏览器里查看。");
    if (!token) throw missing;
    const order = await shop.getOrder(orderId, token).catch((err: unknown) => {
      throw err instanceof ShopError && err.status === 404 ? missing : err;
    });
    if (order.shopId !== v.shop.id) throw missing;
    return { ...v, order, token };
  }

  site.get("/orders/:orderId", async (c) => {
    const { shop: s, urls, page: p, order } = await customerOrder(c);
    // Same rules as the cancel itself, so the page can say up front what will happen.
    const decision = TERMINAL.has(order.status)
      ? null
      : cancellation({ ...order, slotStart: order.slotStart ? new Date(order.slotStart) : null }, s.cancelPolicy, shop.now());
    c.header("cache-control", "no-store");
    return page(c, <OrderPage shop={s} order={order} urls={urls} theme={p.theme} cancel={decision} />);
  });

  site.get("/orders/:orderId/status", async (c) => {
    const { order } = await customerOrder(c);
    c.header("cache-control", "no-store");
    return c.json({ status: order.status });
  });

  // A plain form post (SameSite=Lax keeps it same-site). Whatever the outcome, the order
  // page shows the current state and, if cancelling isn't allowed, why.
  site.post("/orders/:orderId/cancel", async (c) => {
    const { urls, order, token } = await customerOrder(c);
    await shop.cancelOrder(order.id, token).catch((err: unknown) => {
      if (!(err instanceof ShopError && err.status === 409)) throw err;
    });
    return c.redirect(`${urls.shop}/orders/${order.id}`, 303);
  });

  site.get("/llms.txt", async (c) => {
    const { shop: s, urls } = await live(c);
    return c.text(llmsTxt(s, await shop.listProducts(s.slug), urls), 200, { "content-type": "text/plain; charset=utf-8" });
  });

  // Per shop rather than at the domain root, because shops share the domain under /s/.
  // With subdomains this becomes the standard /.well-known/openshop.json.
  site.get("/.well-known/openshop.json", async (c) => {
    const { shop: s, urls } = await live(c);
    return c.json(openshopJson(s, urls));
  });

  return site;
}
