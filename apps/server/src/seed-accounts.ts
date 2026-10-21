import { readFile } from "node:fs/promises";
import type { Hono } from "hono";

// Two workbench accounts for trying OpenShop locally:
// - DEMO went through the whole merchant flow (register → onboarding form → replace the
//   sample products → decorate → publish) and has a few orders;
// - TRY is registered but has no shop yet, so onboarding starts on first login.
// Everything goes through the same HTTP routes the workbench uses. Idempotent.

export const DEMO = { email: "demo@openshop.dev", password: "openshop123", name: "林小满", slug: "moon-nail" };
export const TRY = { email: "try@openshop.dev", password: "openshop123", name: "新店主" };

type App = Pick<Hono, "request">;

// A browser-like client: keeps the session cookie between requests.
function client(app: App, base: string) {
  let cookie = "";
  return async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const raw = body instanceof Blob;
    const res = await app.request(`${base}${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined || raw ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    const text = await res.text();
    if (res.status >= 300 && res.status !== 303) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    return (text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text) as T;
  };
}

interface Product {
  id: string;
  name: string;
  orderOptions: unknown[];
  variants: { id: string }[];
}

// Illustrated covers in seed-assets/, uploaded like a merchant's photos.
const asset = (name: string) => readFile(new URL(`../seed-assets/${name}`, import.meta.url));

const color = { key: "color", label: "颜色", type: "choice", choices: ["裸粉", "奶白", "酒红", "到店再选"], required: true };
const booking = (name: string, description: string, minutes: number, priceFen: number, withColor: boolean, images: string[] = []) => ({
  name,
  description,
  images,
  fulfillment: "booking",
  durationMinutes: minutes,
  orderOptions: withColor ? [color] : [],
  info: [{ label: "时长", value: `约 ${minutes} 分钟` }],
  variants: [{ attributes: {}, priceFen, stock: null }],
  published: true,
});

// Beijing date `days` from now, skipping Mondays (the template's day off).
function upcoming(days: number, hhmm: string) {
  const d = new Date(Date.now() + 8 * 3_600_000 + days * 86_400_000);
  if (d.getUTCDay() === 1) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T${hhmm}:00+08:00`;
}

export async function seedAccounts(app: App, base: string): Promise<boolean> {
  const probe = client(app, base);
  const exists = await probe("POST", "/api/auth/login", { email: DEMO.email, password: DEMO.password }).then(
    () => true,
    () => false,
  );
  if (exists) return false;

  // ---- the finished shop ----
  const call = client(app, base);
  await call("POST", "/api/auth/register", { name: DEMO.name, email: DEMO.email, password: DEMO.password });
  await call("POST", "/api/onboarding", {
    industry: "nail",
    modules: ["booking", "banner", "gallery", "text"],
    name: "满月美甲工作室",
    phone: "13812345678",
    address: "杭州市西湖区文三路 478 号 2 楼",
    description: "日系美甲 · 一人工作室 · 全程一对一，用的都是进口胶。",
    slug: DEMO.slug,
  });

  const upload = async (name: string) => (await call<{ url: string }>("POST", "/api/merchant/uploads", new Blob([await asset(name)], { type: "image/jpeg" }))).url;

  // Replace the sample products with real ones, then add one more.
  const { products, page } = await call<{ products: Product[]; page: { sections: { id: string; type: string }[] } }>("GET", "/api/merchant/shop");
  const real = [
    booking("纯色美甲", "单色或渐变，含修型和基础护理。", 60, 11800, true, [await upload("solid.jpg")]),
    booking("法式微笑美甲", "经典法式白边，也可以换成彩色边。", 90, 16800, true, [await upload("french.jpg")]),
    booking("卸甲 + 手部护理", "温和卸甲，不伤甲面，附送手膜。", 30, 5800, false, [await upload("care.jpg")]),
  ];
  for (const [i, p] of products.entries()) {
    const next = real[i];
    if (next) await call("POST", "/api/merchant/changes", { kind: "product.update", id: p.id, product: next });
    else await call("POST", "/api/merchant/changes", { kind: "product.delete", id: p.id });
  }
  await call("POST", "/api/merchant/changes", {
    kind: "product.create",
    product: booking("猫眼美甲", "磁吸猫眼，换个角度一个颜色，显白显手长。", 90, 19800, true, [await upload("cateye.jpg")]),
  });

  // Decorate: banner copy, an about section, a slightly deeper pink.
  const banner = page.sections.find((s) => s.type === "banner");
  if (banner) {
    await call("POST", "/api/merchant/changes", {
      kind: "section.update",
      id: banner.id,
      props: { title: "新客首单 9 折", subtitle: "工作日 10:00–16:00 预约，再送一次手膜", image: await upload("banner.jpg") },
    });
  }
  const gallery = page.sections.find((s) => s.type === "gallery");
  if (gallery) {
    const images = [];
    for (const [i, caption] of ["樱花渐变", "冰透蓝", "暖橘法式", "黑白格调"].entries()) images.push({ src: await upload(`gallery-${i + 1}.jpg`), caption });
    await call("POST", "/api/merchant/changes", { kind: "section.update", id: gallery.id, props: { title: "最近的作品", images } });
  }
  const text = page.sections.find((s) => s.type === "text");
  if (text) {
    await call("POST", "/api/merchant/changes", {
      kind: "section.update",
      id: text.id,
      props: { title: "关于小满", body: "做了 6 年美甲，开这家一人工作室是想慢慢做好每一双手。每位顾客全程一对一，不赶时间。" },
    });
  }
  await call("POST", "/api/merchant/changes", { kind: "theme.update", patch: { primary: "#c2255c" } });
  await call("POST", "/api/merchant/publish");

  // A few orders: two paid (one placed by a customer's AI agent), one still unpaid.
  const live = await call<Product[]>("GET", `/api/s/${DEMO.slug}/products`);
  const byName = (n: string) => live.find((p) => p.name === n)!;
  const orders = [
    { product: "法式微笑美甲", at: upcoming(2, "14:00"), customer: { name: "王小姐", phone: "13700000001" }, source: "agent", pay: true },
    { product: "猫眼美甲", at: upcoming(3, "11:00"), customer: { name: "陈女士", phone: "13700000002" }, source: "web", pay: true },
    { product: "纯色美甲", at: upcoming(4, "16:00"), customer: { name: "刘同学", phone: "13700000003" }, source: "web", pay: false },
  ];
  for (const o of orders) {
    const p = byName(o.product);
    const created = await call<{ id: string; paymentUrl: string }>("POST", `/api/s/${DEMO.slug}/orders`, {
      items: [{ variantId: p.variants[0]!.id, options: p.orderOptions.length ? { color: "裸粉" } : {} }],
      customer: o.customer,
      slotStart: o.at,
      source: o.source,
    });
    if (!o.pay) continue;
    await call("POST", new URL(created.paymentUrl).pathname);
    // Reading the order picks up the payment now rather than at the next background sync.
    await call("GET", `/api/merchant/orders/${created.id}`);
  }

  // ---- the account that still has to build its shop ----
  await client(app, base)("POST", "/api/auth/register", { name: TRY.name, email: TRY.email, password: TRY.password });
  return true;
}
