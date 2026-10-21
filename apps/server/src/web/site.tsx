/** @jsxImportSource hono/jsx */
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import type { Child } from "hono/jsx";
import { z } from "zod";
import { newOrderSchema } from "../schemas.ts";
import { ShopError, type OpenShop } from "../shop.ts";
import { llmsTxt, openshopJson, type ShopUrls } from "./discovery.ts";
import { NotFound } from "./layout.tsx";
import { OrderPage } from "./order-page.tsx";
import { ProductPage } from "./product-page.tsx";
import { defaultSections, ShopPage } from "./shop-page.tsx";

// One shop's website, with paths relative to the shop root. app.ts mounts it at /s/:slug;
// a Host-based entry (slug.openshop.xx) would mount the same routes at / and set the slug.

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

export function shopSite(shop: OpenShop) {
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

  async function load(c: Context<Env>) {
    const slug = c.get("slug");
    const s = await shop.getShop(slug);
    const urls: ShopUrls = { shop: shop.shopUrl(slug), server: shop.baseUrl };
    return { shop: s, urls };
  }

  site.get("/", async (c) => {
    const { shop: s, urls } = await load(c);
    const products = await shop.listProducts(s.slug);
    return page(c, <ShopPage shop={s} products={products} urls={urls} sections={defaultSections(s)} />);
  });

  site.get("/p/:productId", async (c) => {
    const { shop: s, urls } = await load(c);
    const product = await shop.getProduct(s.slug, c.req.param("productId"));
    return page(c, <ProductPage shop={s} product={product} urls={urls} now={shop.now()} />);
  });

  // The page's form posts here rather than to the JSON API so the token can go into a cookie.
  site.post("/checkout", async (c) => {
    const { shop: s, urls } = await load(c);
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
    const { shop: s, urls } = await load(c);
    const orderId = c.req.param("orderId")!;
    const token = getCookie(c, orderCookie(orderId));
    const missing = new ShopError(404, "order_not_found", "找不到这个订单。订单只能在下单时用的浏览器里查看。");
    if (!token) throw missing;
    const order = await shop.getOrder(orderId, token).catch((err: unknown) => {
      throw err instanceof ShopError && err.status === 404 ? missing : err;
    });
    if (order.shopId !== s.id) throw missing;
    return { shop: s, urls, order };
  }

  site.get("/orders/:orderId", async (c) => {
    const { shop: s, urls, order } = await customerOrder(c);
    c.header("cache-control", "no-store");
    return page(c, <OrderPage shop={s} order={order} urls={urls} />);
  });

  site.get("/orders/:orderId/status", async (c) => {
    const { order } = await customerOrder(c);
    c.header("cache-control", "no-store");
    return c.json({ status: order.status });
  });

  site.get("/llms.txt", async (c) => {
    const { shop: s, urls } = await load(c);
    return c.text(llmsTxt(s, await shop.listProducts(s.slug), urls), 200, { "content-type": "text/plain; charset=utf-8" });
  });

  // Per shop rather than at the domain root, because shops share the domain under /s/.
  // With subdomains this becomes the standard /.well-known/openshop.json.
  site.get("/.well-known/openshop.json", async (c) => {
    const { shop: s, urls } = await load(c);
    return c.json(openshopJson(s, urls));
  });

  return site;
}
