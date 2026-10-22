/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import { sanitizeCustomHtml, type PageConfig, type SectionOf, type SectionType } from "@openshop/core";
import { jsonLd, type ShopUrls } from "./discovery.ts";
import { Icon, Img, jsonForScript, Layout, PreviewBar, price, TitleBar, WEEKDAYS, type PublicProduct, type PublicShop } from "./layout.tsx";

// The shop page renders the shop's page config: each section type from @openshop/core has a
// component here, fed its validated props.

export interface PageCtx {
  shop: PublicShop;
  products: PublicProduct[];
  urls: ShopUrls;
  now: Date;
  // Set on preview links: shows what the merchant still needs to fill in, and sample badges.
  preview: { samples: Set<string> } | null;
}

type Render<T extends SectionType> = (s: SectionOf<T>, ctx: PageCtx) => Child;

const Hint = (p: { children: Child }) => <p class="muted hint">{p.children}</p>;

function fromPrice(p: PublicProduct) {
  const prices = p.variants.map((v) => v.priceFen);
  const low = Math.min(...prices);
  return prices.some((x) => x !== low) ? `${price(low)} 起` : price(low);
}

const soldOut = (p: PublicProduct) => p.fulfillment === "shipping" && p.variants.every((v) => v.stock === 0);

// The announcement line, then the sticky title bar.
const header: Render<"header"> = (s, { shop, urls }) => (
  <>
    {s.props.showDescription && shop.description ? <p class="announce">{shop.description}</p> : null}
    <TitleBar shop={shop} home={urls.shop} />
  </>
);

const banner: Render<"banner"> = (s, { products, urls }) => {
  const target = s.props.productId ? products.find((p) => p.id === s.props.productId) : undefined;
  const cls = s.props.image ? "hero with-img" : "hero";
  const body = (
    <>
      {s.props.image ? <Img src={s.props.image} alt="" class="hero-img" width={800} height={600} eager /> : null}
      <div class="hero-body">
        <h2 class="hero-title">{s.props.title}</h2>
        {s.props.subtitle ? <p class="hero-sub">{s.props.subtitle}</p> : null}
        {target ? <span class="hero-btn">{target.fulfillment === "booking" ? "立即预约" : "去看看"}</span> : null}
      </div>
    </>
  );
  return target ? (
    <a class={cls} id={s.id} href={`${urls.shop}/p/${target.id}`}>
      {body}
    </a>
  ) : (
    <section class={cls} id={s.id}>
      {body}
    </section>
  );
};

const products: Render<"products"> = (s, ctx) => {
  const { fulfillment, productIds, layout } = s.props;
  const pool = ctx.products.filter((p) => fulfillment === "all" || p.fulfillment === fulfillment);
  const shown = productIds === "all" ? pool : productIds.flatMap((id) => pool.filter((p) => p.id === id));
  return (
    <section class="section products" id={s.id}>
      {s.props.title ? (
        <div class="section-head">
          <h2>{s.props.title}</h2>
          {shown.length > 0 ? <span>{shown.length} 项</span> : null}
        </div>
      ) : null}
      {shown.length === 0 ? <p class="muted">店主还没有上架商品。</p> : null}
      <div class={layout === "grid" ? "grid" : "list"}>
        {shown.map((p) => {
          const href = `${ctx.urls.shop}/p/${p.id}`;
          const image = p.images[0];
          const sample = ctx.preview?.samples.has(p.id) ? <span class="badge">示例</span> : null;
          const gone = soldOut(p);
          if (layout === "grid") {
            return (
              <a class="tile" href={href}>
                <div class="tile-media">
                  {image ? <Img src={image} alt={p.name} width={300} height={400} /> : null}
                  {gone ? <span class="tile-tag">售罄</span> : null}
                </div>
                <h3 class="tile-name">
                  {p.name}
                  {sample}
                </h3>
                <p class="tile-price price">{fromPrice(p)}</p>
              </a>
            );
          }
          // The duration once, even when the merchant also wrote it as a fact (时长、用餐时长…).
          const duration = p.fulfillment === "booking" ? `约 ${p.durationMinutes} 分钟` : null;
          const meta = [duration, ...p.info.filter((i) => i.value !== duration).map((i) => `${i.label} ${i.value}`)].filter(Boolean).join(" · ");
          return (
            <a class="row" href={href}>
              {image ? <Img src={image} alt={p.name} class="row-img" width={96} height={96} /> : null}
              <div class="row-body">
                <div class="row-top">
                  <h3>
                    {p.name}
                    {sample}
                  </h3>
                  <span class="leader" />
                  <span class="price">{fromPrice(p)}</span>
                </div>
                {p.description ? <p class="row-desc">{p.description}</p> : null}
                <div class="row-foot">
                  <span class="row-meta">{meta}</span>
                  {gone ? <span class="row-cta off">已售罄</span> : <span class="row-cta">{p.fulfillment === "booking" ? "预约" : "购买"}</span>}
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
};

// Beijing weekday and HH:MM.
function beijing(now: Date) {
  const d = new Date(now.getTime() + 8 * 3_600_000);
  return { weekday: d.getUTCDay(), hhmm: d.toISOString().slice(11, 16) };
}

const booking: Render<"booking"> = (s, { shop, preview, now }) => {
  if (!shop.schedule) return preview ? <Hint>「营业时间」：店铺还没有开启预约，这一块不会显示。</Hint> : null;
  const weekly = [...shop.schedule.weekly].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  const { weekday, hhmm } = beijing(now);
  const today = weekly.filter((h) => h.weekday === weekday);
  const openNow = today.some((h) => h.open <= hhmm && hhmm < h.close);
  const todayText = today.length ? today.map((h) => `${h.open}–${h.close}`).join("，") : null;
  return (
    <section class="section hours" id={s.id}>
      {s.props.title ? <h2>{s.props.title}</h2> : null}
      <p class="today">
        <span class={openNow ? "dot open" : "dot"} />
        {openNow ? `营业中 · 今天 ${todayText}` : todayText ? `今天 ${todayText}` : "今天休息"}
      </p>
      <details class="week">
        <summary>每周营业时间</summary>
        <dl>
          {weekly.map((h) => (
            <>
              <dt class={h.weekday === weekday ? "is-today" : undefined}>{WEEKDAYS[h.weekday]}</dt>
              <dd class={h.weekday === weekday ? "is-today" : undefined}>
                {h.open}–{h.close}
              </dd>
            </>
          ))}
        </dl>
      </details>
      {s.props.note ? <p class="fine">{s.props.note}</p> : null}
      <p class="fine">预约开始前 {shop.cancelPolicy.freeCancelHoursBefore} 小时以上可免费取消，自动退款。</p>
    </section>
  );
};

const gallery: Render<"gallery"> = (s, { preview }) => {
  if (s.props.images.length === 0) return preview ? <Hint>「相册」还没有图片，发布后不会显示。</Hint> : null;
  return (
    <section class="section gallery" id={s.id}>
      {s.props.title ? (
        <div class="section-head">
          <h2>{s.props.title}</h2>
          <span>{s.props.images.length} 张</span>
        </div>
      ) : null}
      <div class="slider">
        {s.props.images.map((img) => (
          <figure>
            <Img src={img.src} alt={img.caption} width={400} height={500} />
            {img.caption ? <figcaption>{img.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
    </section>
  );
};

const text: Render<"text"> = (s, { preview }) => {
  if (!s.props.title && !s.props.body && !s.props.image) return preview ? <Hint>「图文介绍」还是空的，发布后不会显示。</Hint> : null;
  return (
    <section class="section text" id={s.id}>
      {s.props.image ? <Img src={s.props.image} alt={s.props.title} class="text-img" width={600} height={400} /> : null}
      {s.props.title ? <h2>{s.props.title}</h2> : null}
      {s.props.body
        .split(/\n+/)
        .filter(Boolean)
        .map((para) => (
          <p>{para}</p>
        ))}
    </section>
  );
};

const contact: Render<"contact"> = (s, { shop }) => (
  <section class="section contact" id={s.id}>
    {s.props.title ? <h2>{s.props.title}</h2> : null}
    <a class="contact-row" href={`tel:${shop.phone}`}>
      <span class="contact-label">电话</span>
      <span class="grow">{shop.phone}</span>
      <Icon name="phone" />
    </a>
    {shop.address ? (
      <div class="contact-row">
        <span class="contact-label">地址</span>
        <span class="grow">{shop.address}</span>
      </div>
    ) : null}
  </section>
);

// Sanitized again on the way out, in case the allowlist tightened since it was saved.
const custom_html: Render<"custom_html"> = (s) => <section class="section custom" id={s.id} dangerouslySetInnerHTML={{ __html: sanitizeCustomHtml(s.props.html) }} />;

const RENDER: { [T in SectionType]: Render<T> } = { header, banner, products, booking, gallery, text, contact, custom_html };

// Shows the floating button once the product list has scrolled out of view.
const FLOAT_SCRIPT = `(() => {
  const cta = document.querySelector(".float-cta");
  const target = document.querySelector(cta.getAttribute("href"));
  if (!target || !("IntersectionObserver" in window)) return;
  let seen = false;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) seen = true;
    cta.classList.toggle("show", seen && !e.isIntersecting);
  }).observe(target);
})();`;

export function ShopPage(ctx: PageCtx & { page: PageConfig }) {
  const { shop, urls, preview } = ctx;
  const list = ctx.page.sections.find((s) => s.type === "products");
  const books = ctx.products.some((p) => p.fulfillment === "booking");
  return (
    <Layout
      title={preview ? `预览：${shop.name}` : shop.name}
      description={shop.description || `${shop.name}：在线预约和购买`}
      theme={ctx.page.theme}
      head={
        preview ? (
          <meta name="robots" content="noindex" />
        ) : (
          <>
            <link rel="alternate" type="text/plain" title="llms.txt" href={`${urls.shop}/llms.txt`} />
            <link rel="alternate" type="application/json" title="openshop" href={`${urls.shop}/.well-known/openshop.json`} />
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(jsonLd(shop, ctx.products, urls)) }} />
          </>
        )
      }
    >
      {preview ? <PreviewBar /> : null}
      {ctx.page.sections.map((s) => (RENDER[s.type] as Render<SectionType>)(s, ctx))}
      <footer class="site-footer">
        {preview ? null : (
          <p>
            也可以让你的 AI 助手来下单：<a href={`${urls.shop}/llms.txt`}>下单说明</a>
          </p>
        )}
        <p>© {shop.name}</p>
      </footer>
      {list && ctx.products.length > 0 ? (
        <>
          <a class="btn float-cta" href={`#${list.id}`}>
            {books ? "立即预约" : "去选购"}
          </a>
          <script dangerouslySetInnerHTML={{ __html: FLOAT_SCRIPT }} />
        </>
      ) : null}
    </Layout>
  );
}
