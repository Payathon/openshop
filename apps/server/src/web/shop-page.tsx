/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import { sanitizeCustomHtml, type PageConfig, type SectionOf, type SectionType } from "@openshop/core";
import { jsonLd, type ShopUrls } from "./discovery.ts";
import { Img, jsonForScript, Layout, PreviewBar, price, WEEKDAYS, type PublicProduct, type PublicShop } from "./layout.tsx";

// The shop page renders the shop's page config: each section type from @openshop/core has a
// component here, fed its validated props.

export interface PageCtx {
  shop: PublicShop;
  products: PublicProduct[];
  urls: ShopUrls;
  // Set on preview links: shows what the merchant still needs to fill in, and sample badges.
  preview: { samples: Set<string> } | null;
}

type Render<T extends SectionType> = (s: SectionOf<T>, ctx: PageCtx) => Child;

const Hint = (p: { children: Child }) => <p class="muted small hint">{p.children}</p>;

function fromPrice(p: PublicProduct) {
  const prices = p.variants.map((v) => v.priceFen);
  const low = Math.min(...prices);
  return prices.some((x) => x !== low) ? `${price(low)} 起` : price(low);
}

const header: Render<"header"> = (s, { shop }) => (
  <header>
    <h1>{shop.name}</h1>
    {s.props.showDescription && shop.description ? <p class="muted">{shop.description}</p> : null}
  </header>
);

const banner: Render<"banner"> = (s, { products, urls }) => {
  const target = s.props.productId ? products.find((p) => p.id === s.props.productId) : undefined;
  const body = (
    <>
      {s.props.image ? <Img src={s.props.image} alt="" class="banner-img" width={640} height={280} eager /> : null}
      <div class="banner-text">
        <strong>{s.props.title}</strong>
        {s.props.subtitle ? <span>{s.props.subtitle}</span> : null}
      </div>
    </>
  );
  return target ? (
    <a class="banner" href={`${urls.shop}/p/${target.id}`}>
      {body}
    </a>
  ) : (
    <div class="banner">{body}</div>
  );
};

const products: Render<"products"> = (s, ctx) => {
  const { fulfillment, productIds, layout } = s.props;
  const pool = ctx.products.filter((p) => fulfillment === "all" || p.fulfillment === fulfillment);
  const shown = productIds === "all" ? pool : productIds.flatMap((id) => pool.filter((p) => p.id === id));
  return (
    <section class="card" id={s.id}>
      {s.props.title ? <h2>{s.props.title}</h2> : null}
      {shown.length === 0 ? <p class="muted">店主还没有上架商品。</p> : null}
      <div class={layout === "grid" ? "grid" : ""}>
        {shown.map((p) => {
          const soldOut = p.fulfillment === "shipping" && p.variants.every((v) => v.stock === 0);
          const meta = [p.fulfillment === "booking" ? `约 ${p.durationMinutes} 分钟` : null, ...p.info.filter((i) => i.label !== "时长").map((i) => `${i.label}：${i.value}`)]
            .filter(Boolean)
            .join(" · ");
          const href = `${ctx.urls.shop}/p/${p.id}`;
          const image = p.images[0];
          const sample = ctx.preview?.samples.has(p.id) ? <span class="badge">示例</span> : null;
          return layout === "grid" ? (
            <a class="tile" href={href}>
              {image ? <Img src={image} alt={p.name} class="tile-img" width={240} height={240} /> : <div class="tile-img empty" />}
              <h3>
                {p.name}
                {sample}
              </h3>
              <p class="price">{soldOut ? "已售罄" : fromPrice(p)}</p>
            </a>
          ) : (
            <div class="product">
              {image ? <Img src={image} alt={p.name} class="thumb" width={72} height={72} /> : null}
              <div class="grow">
                <h3>
                  {p.name}
                  {sample}
                </h3>
                {p.description ? <p class="muted small">{p.description}</p> : null}
                {meta ? <p class="muted small">{meta}</p> : null}
                <p class="price">{fromPrice(p)}</p>
              </div>
              {soldOut ? (
                <span class="muted small">已售罄</span>
              ) : (
                <a class="btn" href={href}>
                  {p.fulfillment === "booking" ? "预约" : "购买"}
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const booking: Render<"booking"> = (s, { shop, preview }) => {
  if (!shop.schedule) return preview ? <Hint>「营业时间」：店铺还没有开启预约，这一块不会显示。</Hint> : null;
  const weekly = [...shop.schedule.weekly].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  return (
    <section class="card" id={s.id}>
      {s.props.title ? <h2>{s.props.title}</h2> : null}
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
      {s.props.note ? <p class="small">{s.props.note}</p> : null}
      <p class="muted small">预约开始前 {shop.cancelPolicy.freeCancelHoursBefore} 小时以上可免费取消，自动退款。</p>
    </section>
  );
};

const gallery: Render<"gallery"> = (s, { preview }) => {
  if (s.props.images.length === 0) return preview ? <Hint>「相册」还没有图片，发布后不会显示。</Hint> : null;
  return (
    <section class="card" id={s.id}>
      {s.props.title ? <h2>{s.props.title}</h2> : null}
      <div class="gallery">
        {s.props.images.map((img) => (
          <figure>
            <Img src={img.src} alt={img.caption} width={320} height={320} />
            {img.caption ? <figcaption class="small muted">{img.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
    </section>
  );
};

const text: Render<"text"> = (s, { preview }) => {
  if (!s.props.title && !s.props.body && !s.props.image) return preview ? <Hint>「图文介绍」还是空的，发布后不会显示。</Hint> : null;
  return (
    <section class="card" id={s.id}>
      {s.props.title ? <h2>{s.props.title}</h2> : null}
      {s.props.image ? <Img src={s.props.image} alt={s.props.title} class="wide-img" width={640} height={400} /> : null}
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
  <section class="card" id={s.id}>
    {s.props.title ? <h2>{s.props.title}</h2> : null}
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

// Sanitized again on the way out, in case the allowlist tightened since it was saved.
const custom_html: Render<"custom_html"> = (s) => <section class="card custom" id={s.id} dangerouslySetInnerHTML={{ __html: sanitizeCustomHtml(s.props.html) }} />;

const RENDER: { [T in SectionType]: Render<T> } = { header, banner, products, booking, gallery, text, contact, custom_html };

export function ShopPage(ctx: PageCtx & { page: PageConfig }) {
  const { shop, urls, preview } = ctx;
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
      {preview ? null : (
        <footer>
          也可以让你的 AI 助手来下单：<a href={`${urls.shop}/llms.txt`}>下单说明</a>
        </footer>
      )}
    </Layout>
  );
}
