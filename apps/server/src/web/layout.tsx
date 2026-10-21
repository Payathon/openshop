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

// Colours, corner radius and font are tokens; a shop's theme overrides them (themeCss).
const CSS = `
:root{--primary:#d6336c;--primary-ink:#fff;--ink:#1f2328;--muted:#6b7280;--line:#e5e7eb;--bg:#f7f7f8;--card:#fff;--ok:#1a7f37;--warn:#b45309;--bad:#c62828;--radius:14px;--font:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--font);-webkit-text-size-adjust:100%}
img{max-width:100%;height:auto;display:block;background:#eef0f3}
.preview-bar{position:sticky;top:0;z-index:5;margin:-16px -16px 8px;padding:8px 16px;background:#111827;color:#fff;font-size:13px;text-align:center}
.hint{border:1px dashed var(--line);border-radius:var(--radius);padding:10px 12px;margin:12px 0}
.badge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:6px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:500;vertical-align:2px}
.banner{display:block;position:relative;overflow:hidden;border-radius:var(--radius);margin:12px 0;background:var(--primary);color:var(--primary-ink);text-decoration:none}
.banner-img{width:100%;aspect-ratio:16/7;object-fit:cover}
.banner-img+.banner-text{position:absolute;inset:auto 0 0 0;background:linear-gradient(transparent,rgba(0,0,0,.55));color:#fff}
.banner-text{display:flex;flex-direction:column;gap:2px;padding:14px 16px}
.banner-text strong{font-size:18px}.banner-text span{font-size:14px;opacity:.9}
.thumb{width:72px;height:72px;object-fit:cover;border-radius:calc(var(--radius) * .6);flex:0 0 auto}
.grow{flex:1;min-width:0}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.tile{color:inherit;text-decoration:none}
.tile-img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:calc(var(--radius) * .7)}
.tile-img.empty{background:color-mix(in srgb,var(--primary) 10%,#fff)}
.tile h3{font-size:15px;margin:8px 0 0}.tile .price{margin:2px 0 0}
.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.gallery figure{margin:0}.gallery img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:calc(var(--radius) * .4)}
.gallery figcaption{margin-top:2px}
.wide-img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:calc(var(--radius) * .7);margin-bottom:8px}
.photos{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;margin:8px -16px;padding:0 16px;scrollbar-width:none}
.photos img{flex:0 0 86%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius);scroll-snap-align:center}
.photos img:only-child{flex-basis:100%}
.custom img{border-radius:calc(var(--radius) * .5)}
.custom>:first-child{margin-top:0}.custom>:last-child{margin-bottom:0}
main{max-width:560px;margin:0 auto;padding:16px 16px 48px}
a{color:var(--primary)}
h1{font-size:24px;line-height:1.3;margin:8px 0 4px}
h2{font-size:17px;margin:0 0 12px}
.muted{color:var(--muted)}
.small{font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px;margin:12px 0}
.product{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 0;border-top:1px solid var(--line)}
.product:first-of-type{border-top:0;padding-top:0}
.product h3{font-size:16px;margin:0}
.product p{margin:2px 0 0}
.price{font-weight:600;white-space:nowrap}
.btn{display:inline-block;border:0;border-radius:var(--btn-radius,999px);background:var(--primary);color:var(--primary-ink);font:inherit;font-weight:600;padding:8px 18px;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn.ghost{background:transparent;color:var(--bad);border:1px solid var(--line);font-weight:500}
.btn.block{display:block;width:100%;padding:13px;font-size:17px;text-align:center}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:1px solid var(--line);background:var(--card);border-radius:calc(var(--radius) * .7);padding:7px 12px;font:inherit;font-size:15px;color:var(--ink);cursor:pointer}
.chip.on,.chip:has(input:checked){border-color:var(--primary);color:var(--primary);background:color-mix(in srgb,var(--primary) 8%,#fff)}
.chip[disabled]{color:#b8bcc4;cursor:not-allowed}
.chip input{position:absolute;opacity:0;pointer-events:none}
.chip{position:relative}
.days{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.days .chip{flex:0 0 auto;text-align:center;line-height:1.3}
label.field{display:block;margin:12px 0 0}
label.field>span,.label{display:block;font-size:14px;color:var(--muted);margin:0 0 6px}
.label{margin-top:14px}
input[type=text],input[type=tel],input[type=number],textarea{width:100%;border:1px solid var(--line);border-radius:calc(var(--radius) * .7);padding:10px 12px;font:inherit;background:#fff;color:var(--ink)}
input:focus,textarea:focus,.chip:focus-visible,.btn:focus-visible{outline:2px solid color-mix(in srgb,var(--primary) 45%,transparent);outline-offset:1px}
.error{color:var(--bad);min-height:1.5em;margin:12px 0 8px}
.status{font-size:22px;font-weight:700;margin:4px 0}
.status.ok{color:var(--ok)}.status.warn{color:var(--warn)}.status.bad{color:var(--muted)}
dl.rows{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0}
dl.rows dt{color:var(--muted)}dl.rows dd{margin:0}
footer{text-align:center;color:var(--muted);font-size:13px;margin-top:28px}
`;

const FONTS: Record<Theme["font"], string> = {
  system: "",
  rounded: `"SF Pro Rounded","PingFang SC","Hiragino Maru Gothic ProN","Microsoft YaHei",system-ui,sans-serif`,
  serif: `"Songti SC","Noto Serif SC","Source Han Serif SC",STSong,serif`,
};
const RADII: Record<Theme["radius"], [card: string, button: string]> = { square: ["4px", "6px"], soft: ["14px", "999px"], round: ["22px", "999px"] };

// Dark text on light primaries, white on everything else.
function inkOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! > 170 ? "#1f2328" : "#fff";
}

// Theme values are schema-validated (hex colour, fixed enums), so they are safe inside <style>.
function themeCss(t: Theme) {
  const [radius, btn] = RADII[t.radius];
  return `:root{--primary:${t.primary};--primary-ink:${inkOn(t.primary)};--radius:${radius};--btn-radius:${btn}${FONTS[t.font] ? `;--font:${FONTS[t.font]}` : ""}}`;
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
      <body>
        <main>{p.children}</main>
      </body>
    </html>
  );
}

// Lazy by default, with intrinsic size so the layout doesn't jump; CSS sets the real size.
export const Img = (p: { src: string; alt: string; class?: string | undefined; width: number; height: number; eager?: boolean | undefined }) => (
  <img src={p.src} alt={p.alt} class={p.class} width={p.width} height={p.height} loading={p.eager ? "eager" : "lazy"} decoding="async" />
);

export function PreviewBar() {
  return <div class="preview-bar">预览 · 发布后顾客才能看到这些修改</div>;
}

export function NotFound(p: { message: string }) {
  return (
    <Layout title="找不到页面">
      <div class="card">
        <h1>找不到页面</h1>
        <p class="muted">{p.message}</p>
      </div>
    </Layout>
  );
}
