/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import { jsonForScript, Layout, price, WEEKDAYS, type PublicProduct, type PublicShop } from "./layout.tsx";
import { jsonLd, type ShopUrls } from "./discovery.ts";

// The shop page is a list of sections. For now every shop gets the default list; in M4 the
// shop's page config (sections, order, props) and theme replace defaultSections.
export type Section = { type: "header" } | { type: "products" } | { type: "hours" } | { type: "contact" };

export function defaultSections(shop: PublicShop): Section[] {
  return [{ type: "header" }, { type: "products" }, ...(shop.schedule ? [{ type: "hours" } as const] : []), { type: "contact" }];
}

interface Ctx {
  shop: PublicShop;
  products: PublicProduct[];
  urls: ShopUrls;
}

function Header({ shop }: Ctx) {
  return (
    <header>
      <h1>{shop.name}</h1>
      {shop.description ? <p class="muted">{shop.description}</p> : null}
    </header>
  );
}

function fromPrice(p: PublicProduct) {
  const prices = p.variants.map((v) => v.priceFen);
  const low = Math.min(...prices);
  return prices.some((x) => x !== low) ? `${price(low)} 起` : price(low);
}

function Products({ products, urls }: Ctx) {
  return (
    <section class="card" id="products">
      <h2>商品与服务</h2>
      {products.length === 0 ? <p class="muted">店主还没有上架商品。</p> : null}
      {products.map((p) => {
        const soldOut = p.fulfillment === "shipping" && p.variants.every((v) => v.stock === 0);
        const meta = [p.fulfillment === "booking" ? `约 ${p.durationMinutes} 分钟` : null, ...p.info.filter((i) => i.label !== "时长").map((i) => `${i.label}：${i.value}`)]
          .filter(Boolean)
          .join(" · ");
        return (
          <div class="product">
            <div>
              <h3>{p.name}</h3>
              {p.description ? <p class="muted small">{p.description}</p> : null}
              {meta ? <p class="muted small">{meta}</p> : null}
              <p class="price">{fromPrice(p)}</p>
            </div>
            {soldOut ? (
              <span class="muted small">已售罄</span>
            ) : (
              <a class="btn" href={`${urls.shop}/p/${p.id}`}>
                {p.fulfillment === "booking" ? "预约" : "购买"}
              </a>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Hours({ shop }: Ctx) {
  if (!shop.schedule) return null;
  const weekly = [...shop.schedule.weekly].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  return (
    <section class="card">
      <h2>营业时间</h2>
      <dl class="rows">
        {weekly.map((h) => (
          <>
            <dt>{WEEKDAYS[h.weekday]}</dt>
            <dd>
              {h.open}–{h.close}
            </dd>
          </>
        ))}
      </dl>
      <p class="muted small">预约开始前 {shop.cancelPolicy.freeCancelHoursBefore} 小时以上可免费取消，自动退款。</p>
    </section>
  );
}

function Contact({ shop }: Ctx) {
  return (
    <section class="card">
      <h2>联系店铺</h2>
      <dl class="rows">
        <dt>电话</dt>
        <dd>
          <a href={`tel:${shop.phone}`}>{shop.phone}</a>
        </dd>
        {shop.address ? (
          <>
            <dt>地址</dt>
            <dd>{shop.address}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

const SECTIONS: Record<Section["type"], (ctx: Ctx) => Child> = { header: Header, products: Products, hours: Hours, contact: Contact };

export function ShopPage(ctx: Ctx & { sections: Section[] }) {
  const { shop, urls } = ctx;
  return (
    <Layout
      title={shop.name}
      description={shop.description || `${shop.name}：在线预约和购买`}
      head={
        <>
          <link rel="alternate" type="text/plain" title="llms.txt" href={`${urls.shop}/llms.txt`} />
          <link rel="alternate" type="application/json" title="openshop" href={`${urls.shop}/.well-known/openshop.json`} />
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd(shop, ctx.products, urls)) }} />
        </>
      }
    >
      {ctx.sections.map((s) => SECTIONS[s.type](ctx))}
      <footer>
        也可以让你的 AI 助手来下单：<a href={`${urls.shop}/llms.txt`}>下单说明</a>
      </footer>
    </Layout>
  );
}
