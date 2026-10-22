import { readFile } from "node:fs/promises";
import type { Hono } from "hono";

// Workbench accounts for trying OpenShop locally:
// - DEMO, FASHION and DINING each went through the whole merchant flow (register → onboarding
//   form → replace the sample products → decorate → publish) and have a few orders. Each
//   uses a different template: 简约, 服装 and 餐厅;
// - TRY is registered but has no shop yet, so onboarding starts on first login.
// Everything goes through the same HTTP routes the workbench uses. Idempotent per account.

const PASSWORD = "openshop123";
export const DEMO = { email: "demo@openshop.dev", password: PASSWORD, name: "林小满", slug: "moon-nail" };
export const FASHION = { email: "fashion@openshop.dev", password: PASSWORD, name: "周白", slug: "baiyi" };
export const DINING = { email: "food@openshop.dev", password: PASSWORD, name: "陈师傅", slug: "xiangkou" };
export const TRY = { email: "try@openshop.dev", password: PASSWORD, name: "新店主" };

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

type Call = ReturnType<typeof client>;
interface Section {
  id: string;
  type: string;
}

async function exists(app: App, base: string, email: string) {
  return client(app, base)("POST", "/api/auth/login", { email, password: PASSWORD }).then(
    () => true,
    () => false,
  );
}

// Registers and onboards, then hands back what the decorating steps need.
async function openShop(call: Call, account: { name: string; email: string }, onboarding: Record<string, unknown>) {
  await call("POST", "/api/auth/register", { name: account.name, email: account.email, password: PASSWORD });
  await call("POST", "/api/onboarding", onboarding);
  const { page } = await call<{ page: { sections: Section[] } }>("GET", "/api/merchant/shop");
  return {
    upload: async (name: string) => (await call<{ url: string }>("POST", "/api/merchant/uploads", new Blob([await asset(name)], { type: "image/jpeg" }))).url,
    // The template's sample products become the first real ones; the rest are added.
    replaceProducts: async (real: unknown[]) => {
      const { products } = await call<{ products: Product[] }>("GET", "/api/merchant/shop");
      for (const [i, p] of products.entries()) {
        const next = real[i];
        if (next) await call("POST", "/api/merchant/changes", { kind: "product.update", id: p.id, product: next });
        else await call("POST", "/api/merchant/changes", { kind: "product.delete", id: p.id });
      }
      for (const next of real.slice(products.length)) await call("POST", "/api/merchant/changes", { kind: "product.create", product: next });
      return (await call<{ products: Product[] }>("GET", "/api/merchant/shop")).products;
    },
    section: async (type: string, props: Record<string, unknown>) => {
      const s = page.sections.find((x) => x.type === type);
      if (s) await call("POST", "/api/merchant/changes", { kind: "section.update", id: s.id, props });
    },
  };
}

interface DemoOrder {
  product: string;
  customer: { name: string; phone: string };
  source: "web" | "agent";
  pay: boolean;
  at?: string;
  options?: Record<string, string>;
  variant?: number;
}

async function placeOrders(call: Call, slug: string, orders: DemoOrder[]) {
  const live = await call<Product[]>("GET", `/api/s/${slug}/products`);
  for (const o of orders) {
    const p = live.find((x) => x.name === o.product)!;
    const created = await call<{ id: string; paymentUrl: string }>("POST", `/api/s/${slug}/orders`, {
      items: [{ variantId: p.variants[o.variant ?? 0]!.id, options: o.options ?? {} }],
      customer: o.customer,
      ...(o.at ? { slotStart: o.at } : { address: { recipient: o.customer.name, phone: o.customer.phone, region: "上海市 徐汇区", detail: "漕溪北路 88 号 1203 室" } }),
      source: o.source,
    });
    if (!o.pay) continue;
    await call("POST", new URL(created.paymentUrl).pathname);
    // Reading the order picks up the payment now rather than at the next background sync.
    await call("GET", `/api/merchant/orders/${created.id}`);
  }
}

async function seedNail(app: App, base: string) {
  const call = client(app, base);
  const shop = await openShop(call, DEMO, {
    industry: "nail",
    modules: ["booking", "banner", "gallery", "text"],
    style: "minimal",
    name: "满月美甲工作室",
    phone: "13812345678",
    address: "杭州市西湖区文三路 478 号 2 楼",
    description: "日系美甲 · 一人工作室 · 全程一对一，用的都是进口胶。",
    slug: DEMO.slug,
  });
  const u = shop.upload;
  await shop.replaceProducts([
    booking("纯色美甲", "单色或渐变，含修型和基础护理。", 60, 11800, true, [await u("solid.jpg")]),
    booking("法式微笑美甲", "经典法式白边，也可以换成彩色边。", 90, 16800, true, [await u("french.jpg")]),
    booking("卸甲 + 手部护理", "温和卸甲，不伤甲面，附送手膜。", 30, 5800, false, [await u("care.jpg")]),
    booking("猫眼美甲", "磁吸猫眼，换个角度一个颜色，显白显手长。", 90, 19800, true, [await u("cateye.jpg")]),
  ]);
  // Decorate: banner copy, an about section, a slightly deeper pink.
  await shop.section("banner", { title: "新客首单 9 折", subtitle: "工作日 10:00–16:00 预约，再送一次手膜", image: await u("banner.jpg") });
  const images = [];
  for (const [i, caption] of ["樱花渐变", "冰透蓝", "暖橘法式", "黑白格调"].entries()) images.push({ src: await u(`gallery-${i + 1}.jpg`), caption });
  await shop.section("gallery", { title: "最近的作品", images });
  await shop.section("text", { title: "关于小满", body: "做了 6 年美甲，开这家一人工作室是想慢慢做好每一双手。每位顾客全程一对一，不赶时间。" });
  await call("POST", "/api/merchant/changes", { kind: "theme.update", patch: { primary: "#c2255c" } });
  await call("POST", "/api/merchant/publish");

  // A few orders: two paid (one placed by a customer's AI agent), one still unpaid.
  await placeOrders(call, DEMO.slug, [
    { product: "法式微笑美甲", at: upcoming(2, "14:00"), customer: { name: "王小姐", phone: "13700000001" }, source: "agent", pay: true, options: { color: "裸粉" } },
    { product: "猫眼美甲", at: upcoming(3, "11:00"), customer: { name: "陈女士", phone: "13700000002" }, source: "web", pay: true, options: { color: "裸粉" } },
    { product: "纯色美甲", at: upcoming(4, "16:00"), customer: { name: "刘同学", phone: "13700000003" }, source: "web", pay: false, options: { color: "裸粉" } },
  ]);
}

const sizes = (names: string[], priceFen: number, stock: (size: string) => number) =>
  names.map((size) => ({ attributes: { 尺码: size }, priceFen, stock: stock(size) }));
const garment = (name: string, description: string, images: string[], variants: unknown[], info: { label: string; value: string }[] = []) => ({
  name,
  description,
  images,
  fulfillment: "shipping",
  durationMinutes: null,
  orderOptions: [],
  info,
  variants,
  published: true,
});

async function seedFashion(app: App, base: string) {
  const call = client(app, base);
  const shop = await openShop(call, FASHION, {
    industry: "fashion",
    name: "白日衣橱",
    phone: "13912345678",
    description: "原创设计 · 小批量生产 · 满 299 包邮，7 天无理由退换",
    slug: FASHION.slug,
  });
  const u = shop.upload;
  const products = [
    garment("落肩连帽卫衣", "400g 重磅毛圈，落肩宽松版型，男女同款。", [await u("fashion-hoodie.jpg")], sizes(["S", "M", "L"], 23900, () => 30), [{ label: "面料", value: "100% 棉" }]),
    garment("竖条纹宽松衬衫", "蓝白竖条纹，衣长盖臀，可以当薄外套。", [await u("fashion-shirt.jpg")], sizes(["S", "M", "L"], 19900, () => 20), [{ label: "面料", value: "棉麻混纺" }]),
    garment("高腰直筒牛仔裤", "高腰显腿长，直筒不挑腿型，水洗做旧。", [await u("fashion-jeans.jpg")], sizes(["26", "27", "28", "29"], 25900, () => 12)),
    garment("羊毛混纺大衣", "双排扣，落肩廓形，50% 羊毛。", [await u("fashion-coat.jpg")], sizes(["S", "M", "L"], 69900, (s) => (s === "L" ? 0 : 6)), [{ label: "面料", value: "50% 羊毛" }]),
    garment("复古针织开衫", "砖红色粗针织，配金色纽扣。", [await u("fashion-cardigan.jpg")], sizes(["均码"], 28900, () => 0)),
    garment("帆布托特包", "加厚帆布，能放下 14 寸电脑。", [await u("fashion-tote.jpg")], [{ attributes: {}, priceFen: 12900, stock: 50 }]),
  ];
  const mine = await shop.replaceProducts(products);
  await shop.section("banner", {
    title: "秋冬新品",
    subtitle: "大衣、针织和重磅卫衣，本周上新",
    image: await u("fashion-banner.jpg"),
    productId: mine.find((p) => p.name === "羊毛混纺大衣")?.id ?? null,
  });
  await shop.section("text", { title: "关于白日", body: "两个人的小品牌，自己画图、自己找工厂打版。每款只做一两百件，卖完就不补了。" });
  await call("POST", "/api/merchant/publish");
  await placeOrders(call, FASHION.slug, [
    { product: "落肩连帽卫衣", customer: { name: "赵先生", phone: "13700000011" }, source: "web", pay: true, variant: 1 },
    { product: "高腰直筒牛仔裤", customer: { name: "孙小姐", phone: "13700000012" }, source: "agent", pay: true, variant: 2 },
  ]);
}

const table = (name: string, description: string, minutes: number, priceFen: number, images: string[]) => ({
  name,
  description,
  images,
  fulfillment: "booking",
  durationMinutes: minutes,
  orderOptions: [],
  info: [{ label: "用餐时长", value: `约 ${minutes} 分钟` }],
  variants: [{ attributes: {}, priceFen, stock: null }],
  published: true,
});

async function seedDining(app: App, base: string) {
  const call = client(app, base);
  const shop = await openShop(call, DINING, {
    industry: "restaurant",
    modules: ["booking", "shopping", "banner", "text", "gallery"],
    name: "巷口小馆",
    phone: "13612345678",
    address: "成都市武侯区玉林西路 21 号",
    description: "开在巷子里的家常川菜馆 · 每天 11:00 开门",
    slug: DINING.slug,
  });
  const u = shop.upload;
  const products = [
    table("2–4 人订座", "定金 ¥50，到店抵扣餐费。超过 15 分钟没到，座位会让给排队的客人。", 90, 5000, [await u("dining-room.jpg")]),
    table("双人招牌套餐", "红烧肉、酸菜鱼、一份时蔬、两碗米饭。", 90, 16800, [await u("dining-set-two.jpg")]),
    table("四人家宴", "红烧肉、酸菜鱼、牛肉面、凉菜两份、时蔬、米饭不限。", 120, 39800, [await u("dining-dish-fish.jpg")]),
    table("6–10 人包间", "定金 ¥200，到店抵扣。包间有独立空调和电视。", 150, 20000, [await u("dining-dish-pork.jpg")]),
    {
      name: "秘制辣椒酱 两瓶装",
      description: "店里拌面用的那款，二荆条加菜籽油慢炒。",
      images: [await u("dining-sauce.jpg")],
      fulfillment: "shipping",
      durationMinutes: null,
      orderOptions: [],
      info: [{ label: "保质期", value: "6 个月" }],
      variants: [{ attributes: { 规格: "微辣" }, priceFen: 5800, stock: 40 }, { attributes: { 规格: "特辣" }, priceFen: 5800, stock: 25 }],
      published: true,
    },
  ];
  const mine = await shop.replaceProducts(products);
  await shop.section("banner", {
    title: "工作日午市套餐",
    subtitle: "11:00–14:00，两菜一汤 ¥48",
    image: await u("dining-banner.jpg"),
    productId: mine.find((p) => p.name === "双人招牌套餐")?.id ?? null,
  });
  await shop.section("text", { title: "关于小馆", body: "老陈在这条巷子里炒了十二年菜。菜单跟着时令换，辣椒酱和腊肉都是自己做的。" });
  const images = [];
  for (const [file, caption] of [["dining-dish-pork.jpg", "红烧肉"], ["dining-dish-fish.jpg", "酸菜鱼"], ["dining-dish-noodle.jpg", "红烧牛肉面"], ["dining-room.jpg", "晚上的大堂"]] as const) {
    images.push({ src: await u(file), caption });
  }
  await shop.section("gallery", { title: "招牌菜", images });
  await call("POST", "/api/merchant/publish");
  await placeOrders(call, DINING.slug, [
    { product: "双人招牌套餐", at: upcoming(1, "18:00"), customer: { name: "吴先生", phone: "13700000021" }, source: "agent", pay: true },
    { product: "2–4 人订座", at: upcoming(2, "12:00"), customer: { name: "郑女士", phone: "13700000022" }, source: "web", pay: true },
  ]);
}

// Creates whichever demo accounts are missing; true if it created any.
export async function seedAccounts(app: App, base: string): Promise<boolean> {
  let created = false;
  const seeds: [string, () => Promise<unknown>][] = [
    [DEMO.email, () => seedNail(app, base)],
    [FASHION.email, () => seedFashion(app, base)],
    [DINING.email, () => seedDining(app, base)],
    [TRY.email, () => client(app, base)("POST", "/api/auth/register", { name: TRY.name, email: TRY.email, password: TRY.password })],
  ];
  for (const [email, seed] of seeds) {
    if (await exists(app, base, email)) continue;
    await seed();
    created = true;
  }
  return created;
}
