/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import type { Theme } from "@openshop/core";
import type { OpenShop } from "../shop.ts";

export type PublicShop = Awaited<ReturnType<OpenShop["getShop"]>>;
export type PublicProduct = Awaited<ReturnType<OpenShop["listProducts"]>>[number];

export const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 16800 -> "¥168", 1250 -> "¥12.50"
export const price = (fen: number) => `¥${fen % 100 === 0 ? fen / 100 : (fen / 100).toFixed(2)}`;

export const variantLabel = (attributes: Record<string, string>) => Object.values(attributes).join(" / ");

// Embeds data for inline scripts; `<` is escaped so the JSON can't close the script tag.
export const jsonForScript = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

// One stylesheet for every template. The layout follows Shopify's Dawn on a phone: full-bleed
// images, a centred title bar, quiet type and lots of white space. A shop's template (data-style
// on <body>) and theme only change tokens and a few treatments, so content never depends on them.
const CSS = `
:root{--primary:#d6336c;--primary-ink:#fff;--ink:#121212;--muted:rgba(18,18,18,.66);--line:rgba(18,18,18,.1);--bg:#fff;--surface:#f3f3f3;--card:#fff;--tint:var(--surface);--select:var(--ink);--select-ink:#fff;--ok:#1a7f37;--warn:#b45309;--bad:#c62828;--radius:0px;--btn-radius:0px;--font:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;--head-font:var(--font);--head-weight:500;--track:.02em;--gutter:16px;color-scheme:light}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:64px}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 var(--font);letter-spacing:var(--track)}
main{max-width:600px;margin:0 auto;min-height:100vh;background:var(--bg)}
img{max-width:100%;height:auto;display:block;background:var(--surface)}
a{color:inherit}
h1,h2,h3{font-family:var(--head-font);font-weight:var(--head-weight);letter-spacing:var(--track);margin:0;text-wrap:balance}
p{margin:0}
.muted{color:var(--muted)}.small{font-size:13px}
.price{font-variant-numeric:tabular-nums;white-space:nowrap}
.icon{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.badge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:4px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:500;letter-spacing:0;vertical-align:2px}
.preview-bar{padding:8px var(--gutter);background:#111827;color:#fff;font-size:13px;text-align:center}
.hint{border:1px dashed var(--line);border-radius:8px;padding:10px 12px;margin:16px var(--gutter);font-size:13px}

/* title bar, announcement, footer */
.announce{padding:8px var(--gutter);border-bottom:1px solid var(--line);font-size:12px;text-align:center;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.bar{position:sticky;top:0;z-index:4;display:grid;grid-template-columns:44px 1fr 44px;align-items:center;min-height:56px;padding:0 6px;background:var(--bg);border-bottom:1px solid var(--line)}
.bar-title{text-align:center;font-family:var(--head-font);font-size:17px;font-weight:600;letter-spacing:.12em;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-btn{display:grid;place-items:center;width:44px;height:44px;color:var(--ink);text-decoration:none}
.site-footer{padding:40px var(--gutter) 120px;border-top:1px solid var(--line);text-align:center;font-size:13px;color:var(--muted);display:grid;gap:6px}
.site-footer a{color:var(--ink)}

/* sections */
.section{padding:40px var(--gutter)}
.section+.section{padding-top:8px}
.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:20px}
.section-head h2,.section>h2{font-size:22px;line-height:1.35}
.section>h2{margin-bottom:20px}
.section-head span{font-size:13px;color:var(--muted)}

/* banner */
.hero{display:block;position:relative;color:var(--primary-ink);background:var(--primary);text-decoration:none;overflow:hidden}
.hero-img{width:100%;aspect-ratio:4/3;object-fit:cover}
.hero-body{display:grid;justify-items:center;gap:10px;padding:56px var(--gutter);text-align:center}
.hero-title{font-size:30px;line-height:1.25}
.hero-sub{font-size:15px;opacity:.9}
.hero-btn{margin-top:8px;display:inline-block;padding:11px 28px;border:1px solid currentColor;border-radius:var(--btn-radius);font-size:14px;letter-spacing:.1em}
.hero.with-img{background:#000;color:#fff}
.hero.with-img .hero-body{position:absolute;inset:0;align-content:center;background:rgba(0,0,0,.32)}

/* product grid */
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 10px}
.tile{display:grid;gap:4px;text-decoration:none;min-width:0}
.tile-media{position:relative;overflow:hidden;border-radius:var(--radius);background:var(--surface);aspect-ratio:1;margin-bottom:8px}
.tile-media img{width:100%;height:100%;object-fit:cover}
.tile-name{font-size:14px;line-height:1.5;font-family:var(--font);font-weight:400}
.tile-price{font-size:15px}
.tile-tag{position:absolute;left:8px;bottom:8px;padding:1px 10px;border-radius:40px;background:var(--ink);color:#fff;font-size:12px}

/* product list */
.list{display:grid}
.row{display:flex;gap:14px;padding:18px 0;border-top:1px solid var(--line);text-decoration:none;min-width:0}
.row:first-child{border-top:0;padding-top:0}
.row-img{width:92px;height:92px;flex:0 0 auto;object-fit:cover;border-radius:var(--radius)}
.row-body{flex:1;min-width:0;display:grid;gap:4px;align-content:start}
.row-top{display:flex;align-items:baseline;gap:8px}
.row-top h3{font-size:16px;line-height:1.45;font-family:var(--font);font-weight:500;flex:0 1 auto;min-width:0}
.leader{flex:1}
.row-top .price{font-size:15px}
.row-desc{font-size:13px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.row-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}
.row-meta{font-size:13px;color:var(--muted)}
.row-cta{padding:4px 14px;border:1px solid var(--ink);border-radius:var(--btn-radius);font-size:13px;white-space:nowrap}
.row-cta.off{border-color:var(--line);color:var(--muted)}

/* hours */
.today{display:flex;align-items:center;gap:8px;font-size:16px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:0 0 auto}
.dot.open{background:var(--ok)}
details.week{margin-top:12px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
details.week summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;padding:12px 0;font-size:14px}
details.week summary::-webkit-details-marker{display:none}
details.week summary::after{content:"＋";color:var(--muted)}
details.week[open] summary::after{content:"－"}
.week dl{display:grid;grid-template-columns:auto 1fr;gap:6px 24px;margin:0 0 14px;font-size:14px}
.week dd{margin:0;font-variant-numeric:tabular-nums}
.week .is-today{font-weight:600}
.fine{margin-top:12px;font-size:13px;color:var(--muted)}

/* gallery */
.slider{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-padding-inline:var(--gutter);margin:0 calc(-1 * var(--gutter));padding:0 var(--gutter);scrollbar-width:none}
.slider::-webkit-scrollbar{display:none}
.slider figure{flex:0 0 72%;margin:0;scroll-snap-align:start}
.slider img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:var(--radius)}
.slider figcaption{margin-top:8px;font-size:13px;color:var(--muted)}

/* text */
.text{text-align:center;display:grid;gap:14px}
.text>h2{margin:0}
.text p{color:var(--muted);max-width:32em;margin:0 auto}
.text-img{width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:var(--radius);margin-bottom:8px}
.custom img{border-radius:var(--radius)}
.custom>:first-child{margin-top:0}.custom>:last-child{margin-bottom:0}

/* contact */
.contact-row{display:flex;gap:16px;align-items:center;padding:14px 0;border-top:1px solid var(--line);text-decoration:none;font-size:15px}
.contact-row:last-child{border-bottom:1px solid var(--line)}
.contact-row dt,.contact-label{color:var(--muted);flex:0 0 3em}
.contact-row .grow{flex:1;min-width:0}

/* buttons and form controls */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:46px;border:1px solid var(--primary);border-radius:var(--btn-radius);background:var(--primary);color:var(--primary-ink);font:inherit;font-size:15px;letter-spacing:.08em;padding:0 22px;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--ink)}
.btn.danger{background:transparent;color:var(--bad);border-color:var(--line)}
.btn.block{display:flex;width:100%}
.float-cta{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:5;transform:translate(-50%,20px);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;box-shadow:0 6px 20px rgba(0,0,0,.18);min-width:200px}
.float-cta.show{opacity:1;transform:translate(-50%,0);pointer-events:auto}
@media (prefers-reduced-motion:reduce){.float-cta{transition:none}html{scroll-behavior:auto}}
fieldset{border:0;margin:0;padding:0;min-width:0}
legend,.label{display:block;padding:0;margin:0 0 10px;font-size:14px;color:var(--muted)}
.field{display:grid;gap:8px}
.field>span{font-size:14px;color:var(--muted)}
.pills{display:flex;flex-wrap:wrap;gap:8px}
.pill{position:relative;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;min-height:40px;border:1px solid var(--line);background:var(--card);border-radius:40px;padding:6px 18px;font:inherit;font-size:14px;color:var(--ink);cursor:pointer;line-height:1.3}
.pill input{position:absolute;opacity:0;pointer-events:none}
.pill.on,.pill:has(input:checked){background:var(--select);border-color:var(--select);color:var(--select-ink)}
.pill[disabled]{color:rgba(18,18,18,.3);text-decoration:line-through;cursor:not-allowed}
.pill small{font-size:12px;opacity:.75}
.days{flex-wrap:nowrap;overflow-x:auto;scroll-padding-inline:var(--gutter);margin:0 calc(-1 * var(--gutter));padding:0 var(--gutter) 2px;scrollbar-width:none}
.days::-webkit-scrollbar{display:none}
.days .pill{flex:0 0 auto;border-radius:calc(var(--radius) + 8px);padding:6px 14px}
input[type=text],input[type=tel],input[type=number],textarea{width:100%;min-height:48px;border:1px solid var(--line);border-radius:var(--radius);padding:10px 14px;font:inherit;background:var(--card);color:var(--ink);letter-spacing:0}
input:focus-visible,textarea:focus-visible,.pill:focus-visible,.pill:has(input:focus-visible),.btn:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
.qty{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:var(--radius);width:max-content}
.qty input{width:56px;min-height:46px;border:0;text-align:center;padding:0;-moz-appearance:textfield;background:transparent}
.qty input::-webkit-inner-spin-button{-webkit-appearance:none}
.qty button{width:46px;height:46px;border:0;background:none;font-size:20px;color:var(--ink);cursor:pointer}
.error{color:var(--bad);font-size:14px;min-height:1.5em}

/* product page */
.media{position:relative;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;background:var(--surface)}
.media::-webkit-scrollbar{display:none}
.media img{flex:0 0 100%;width:100%;aspect-ratio:1;object-fit:cover;scroll-snap-align:center}
.media-count{position:absolute;right:12px;bottom:12px;padding:2px 10px;border-radius:40px;background:rgba(255,255,255,.85);font-size:12px}
.media-wrap{position:relative}
.pd{padding:24px var(--gutter) 8px;display:grid;gap:10px}
.pd-vendor{font-size:12px;letter-spacing:.14em;color:var(--muted)}
.pd h1{font-size:26px;line-height:1.3}
.pd .price{font-size:18px}
.pd-desc{color:var(--muted)}
.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 20px;margin:6px 0 0;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:14px}
.facts dt{color:var(--muted)}.facts dd{margin:0}
.checkout{padding:20px var(--gutter) 0;display:grid;gap:26px}
.checkout .fine{text-align:center;margin:0}
.pay-bar{position:sticky;bottom:0;z-index:4;display:flex;align-items:center;gap:16px;margin-top:28px;padding:12px var(--gutter) calc(12px + env(safe-area-inset-bottom,0px));background:var(--bg);border-top:1px solid var(--line)}
.pay-bar .total{flex:1;display:grid;line-height:1.3}
.pay-bar .total strong{font-size:20px;font-weight:600}
.pay-bar .btn{flex:0 0 52%}

/* order page */
.status{font-size:26px;line-height:1.3}
.status.ok{color:var(--ok)}.status.warn{color:var(--warn)}.status.bad{color:var(--muted)}
.order-head{display:grid;gap:12px}
.rows{display:grid;grid-template-columns:auto 1fr;gap:10px 20px;margin:0;font-size:15px}
.rows dt{color:var(--muted)}.rows dd{margin:0;min-width:0;overflow-wrap:anywhere}
.notice{padding:40px var(--gutter);text-align:center;display:grid;gap:10px}

/* ---- 服装: editorial, tall pictures, bold type ---- */
[data-style=fashion]{--head-weight:700;--track:.01em}
[data-style=fashion] .announce{background:var(--ink);color:#fff;border:0}
[data-style=fashion] .bar-title{font-weight:800;letter-spacing:.2em}
[data-style=fashion] .hero-img{aspect-ratio:4/5}
[data-style=fashion] .hero.with-img .hero-body{justify-items:start;align-content:end;text-align:left;padding:28px 20px;background:linear-gradient(transparent 45%,rgba(0,0,0,.55))}
[data-style=fashion] .hero-title{font-size:38px;line-height:1.1;font-weight:800}
[data-style=fashion] .hero-btn{background:#fff;color:#121212;border-color:#fff}
[data-style=fashion] .tile-media{aspect-ratio:3/4}
[data-style=fashion] .section-head h2,[data-style=fashion] .section>h2{font-size:24px}
[data-style=fashion] .media img{aspect-ratio:3/4}
[data-style=fashion] .text{text-align:left}
[data-style=fashion] .text p{margin:0}

/* ---- 餐厅: a printed menu on warm paper ---- */
[data-style=dining]{--bg:color-mix(in srgb,var(--primary) 4%,#fbf7f0);--surface:color-mix(in srgb,var(--primary) 9%,#f1ebe1);--card:#fffdf9;--line:rgba(60,40,20,.14);--ink:#2b211a;--muted:rgba(43,33,26,.66);--select:var(--primary);--select-ink:var(--primary-ink);--head-weight:600}
[data-style=dining] .bar-title{letter-spacing:.3em}
[data-style=dining] .section-head{justify-content:center;flex-direction:column;align-items:center;gap:6px}
[data-style=dining] .section-head h2,[data-style=dining] .section>h2{text-align:center;font-size:22px;letter-spacing:.2em}
[data-style=dining] .section-head h2::after,[data-style=dining] .section>h2::after{content:"";display:block;width:28px;height:2px;margin:10px auto 0;background:var(--primary)}
[data-style=dining] .hero.with-img{margin:16px var(--gutter) 0;border-radius:var(--radius);background:var(--card);color:var(--ink);border:1px solid var(--line)}
[data-style=dining] .hero.with-img .hero-body{position:static;background:none;padding:22px var(--gutter) 26px}
[data-style=dining] .hero.with-img .hero-sub{color:var(--muted);opacity:1}
[data-style=dining] .hero.with-img .hero-btn{border-color:var(--primary);color:var(--primary)}
[data-style=dining] .hero-img{aspect-ratio:16/10}
[data-style=dining] .leader{border-bottom:1px dotted rgba(60,40,20,.4);transform:translateY(-5px);min-width:16px}
[data-style=dining] .row{border-top-style:dashed}
[data-style=dining] .row-img{width:76px;height:76px;order:2}
[data-style=dining] .row-top .price{color:var(--primary);font-weight:600}
[data-style=dining] .row-cta{border-color:var(--primary);color:var(--primary)}
[data-style=dining] .hours{margin:16px var(--gutter);padding:28px 20px;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);text-align:center}
[data-style=dining] .hours .today{justify-content:center;font-size:18px}
[data-style=dining] .hours details.week{text-align:left}
[data-style=dining] .site-footer{border-top-style:dashed}

/* ---- 美业: soft tinted bands and rounded cards ---- */
[data-style=beauty]{--tint:color-mix(in srgb,var(--primary) 8%,#fff);--surface:color-mix(in srgb,var(--primary) 6%,#f6f6f6);--select:var(--primary);--select-ink:var(--primary-ink);--line:rgba(18,18,18,.08)}
[data-style=beauty] .announce{background:var(--tint);border:0;color:var(--ink)}
[data-style=beauty] .bar{border:0}
[data-style=beauty] .hero.with-img{background:var(--bg);color:var(--ink);padding:0 var(--gutter)}
[data-style=beauty] .hero.with-img .hero-img{border-radius:var(--radius)}
[data-style=beauty] .hero.with-img .hero-body{position:relative;inset:auto;margin:-48px 14px 0;padding:26px 20px;border-radius:var(--radius);background:linear-gradient(135deg,color-mix(in srgb,var(--primary) 16%,#fff),color-mix(in srgb,var(--primary) 6%,#fff));justify-items:start;text-align:left}
[data-style=beauty] .hero.with-img .hero-btn{background:var(--primary);color:var(--primary-ink);border-color:var(--primary)}
[data-style=beauty] .hero:not(.with-img){margin:16px var(--gutter) 0;border-radius:var(--radius)}
[data-style=beauty] .products{background:var(--tint);margin-top:32px;padding-top:36px;padding-bottom:36px}
[data-style=beauty] .products .list{gap:12px}
[data-style=beauty] .products .row{background:var(--card);border:0;border-radius:var(--radius);padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
[data-style=beauty] .products .row-img{width:96px;height:96px;border-radius:calc(var(--radius) * .7)}
[data-style=beauty] .row-cta{background:var(--primary);border-color:var(--primary);color:var(--primary-ink)}
[data-style=beauty] .row-cta.off{background:none;border-color:var(--line);color:var(--muted)}
[data-style=beauty] .products+.section{padding-top:40px}
[data-style=beauty] .hours{margin:32px var(--gutter) 0;padding:24px 20px;background:var(--tint);border-radius:var(--radius)}
[data-style=beauty] .hours+.section{padding-top:40px}
[data-style=beauty] .hours details.week{border-color:rgba(0,0,0,.06)}
[data-style=beauty] .slider img{aspect-ratio:1}
`;

const FONTS: Record<Theme["font"], string> = {
  system: "",
  rounded: `"SF Pro Rounded","PingFang SC","Hiragino Maru Gothic ProN","Microsoft YaHei",system-ui,sans-serif`,
  serif: `"Songti SC","Noto Serif SC","Source Han Serif SC",STSong,serif`,
};
// [images and cards, buttons]
const RADII: Record<Theme["radius"], [string, string]> = { square: ["0px", "0px"], soft: ["10px", "8px"], round: ["20px", "999px"] };

// Dark text on light primaries, white on everything else.
function inkOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 170 ? "#121212" : "#fff";
}

// Theme values are schema-validated (hex colour, fixed enums), so they are safe inside <style>.
function themeCss(t: Theme) {
  const [radius, btn] = RADII[t.radius];
  // Serif reads best for titles only; body text stays in the system face.
  const font = t.font === "serif" ? `--head-font:${FONTS.serif}` : FONTS[t.font] ? `--font:${FONTS[t.font]}` : "";
  return `:root{--primary:${t.primary};--primary-ink:${inkOn(t.primary)};--radius:${radius};--btn-radius:${btn}${font ? `;${font}` : ""}}`;
}

export function Layout(p: { title: string; description?: string; head?: Child; theme?: Theme | undefined; children: Child }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{p.title}</title>
        <link rel="icon" href="data:," />
        {p.description ? <meta name="description" content={p.description} /> : null}
        <style dangerouslySetInnerHTML={{ __html: CSS + (p.theme ? themeCss(p.theme) : "") }} />
        {p.head}
      </head>
      <body data-style={p.theme?.style ?? "minimal"}>
        <main>{p.children}</main>
      </body>
    </html>
  );
}

// Lazy by default, with intrinsic size so the layout doesn't jump; CSS sets the real size.
export const Img = (p: { src: string; alt: string; class?: string | undefined; width: number; height: number; eager?: boolean | undefined }) => (
  <img src={p.src} alt={p.alt} class={p.class} width={p.width} height={p.height} loading={p.eager ? "eager" : "lazy"} decoding="async" />
);

const PATHS = {
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  back: "M15 5l-7 7 7 7",
  next: "M9 5l7 7-7 7",
};
export const Icon = (p: { name: keyof typeof PATHS }) => (
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d={PATHS[p.name]} />
  </svg>
);

// The shop's title bar: back (on inner pages), the name in the middle, and a call button.
export function TitleBar(p: { shop: PublicShop; home: string; back?: string | undefined }) {
  return (
    <div class="bar">
      {p.back ? (
        <a class="bar-btn" href={p.back} aria-label="返回">
          <Icon name="back" />
        </a>
      ) : (
        <span />
      )}
      <a class="bar-title" href={p.home}>
        {p.shop.name}
      </a>
      <a class="bar-btn" href={`tel:${p.shop.phone}`} aria-label={`打电话给店铺 ${p.shop.phone}`}>
        <Icon name="phone" />
      </a>
    </div>
  );
}

export function PreviewBar() {
  return <div class="preview-bar">预览 · 发布后顾客才能看到这些修改</div>;
}

export function NotFound(p: { message: string }) {
  return (
    <Layout title="找不到页面">
      <div class="notice">
        <h1>找不到页面</h1>
        <p class="muted">{p.message}</p>
      </div>
    </Layout>
  );
}
