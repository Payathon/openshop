/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import type { OpenShop } from "../shop.ts";

export type PublicShop = Awaited<ReturnType<OpenShop["getShop"]>>;
export type PublicProduct = Awaited<ReturnType<OpenShop["listProducts"]>>[number];

export const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 16800 -> "¥168", 1250 -> "¥12.50"
export const price = (fen: number) => `¥${fen % 100 === 0 ? fen / 100 : (fen / 100).toFixed(2)}`;

export const variantLabel = (attributes: Record<string, string>) => Object.values(attributes).join(" / ");

// Embeds data for inline scripts; `<` is escaped so the JSON can't close the script tag.
export const jsonForScript = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");

// Colours are tokens so a shop theme (M4) can override them.
const CSS = `
:root{--primary:#d6336c;--primary-ink:#fff;--ink:#1f2328;--muted:#6b7280;--line:#e5e7eb;--bg:#f7f7f8;--card:#fff;--ok:#1a7f37;--warn:#b45309;--bad:#c62828;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:560px;margin:0 auto;padding:16px 16px 48px}
a{color:var(--primary)}
h1{font-size:24px;line-height:1.3;margin:8px 0 4px}
h2{font-size:17px;margin:0 0 12px}
.muted{color:var(--muted)}
.small{font-size:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:12px 0}
.product{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 0;border-top:1px solid var(--line)}
.product:first-of-type{border-top:0;padding-top:0}
.product h3{font-size:16px;margin:0}
.product p{margin:2px 0 0}
.price{font-weight:600;white-space:nowrap}
.btn{display:inline-block;border:0;border-radius:999px;background:var(--primary);color:var(--primary-ink);font:inherit;font-weight:600;padding:8px 18px;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.btn.block{display:block;width:100%;padding:13px;font-size:17px;text-align:center}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:7px 12px;font:inherit;font-size:15px;color:var(--ink);cursor:pointer}
.chip.on,.chip:has(input:checked){border-color:var(--primary);color:var(--primary);background:color-mix(in srgb,var(--primary) 8%,#fff)}
.chip[disabled]{color:#b8bcc4;cursor:not-allowed}
.chip input{position:absolute;opacity:0;pointer-events:none}
.chip{position:relative}
.days{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
.days .chip{flex:0 0 auto;text-align:center;line-height:1.3}
label.field{display:block;margin:12px 0 0}
label.field>span,.label{display:block;font-size:14px;color:var(--muted);margin:0 0 6px}
.label{margin-top:14px}
input[type=text],input[type=tel],input[type=number],textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;background:#fff;color:var(--ink)}
input:focus,textarea:focus,.chip:focus-visible,.btn:focus-visible{outline:2px solid color-mix(in srgb,var(--primary) 45%,transparent);outline-offset:1px}
.error{color:var(--bad);min-height:1.5em;margin:12px 0 8px}
.status{font-size:22px;font-weight:700;margin:4px 0}
.status.ok{color:var(--ok)}.status.warn{color:var(--warn)}.status.bad{color:var(--muted)}
dl.rows{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0}
dl.rows dt{color:var(--muted)}dl.rows dd{margin:0}
footer{text-align:center;color:var(--muted);font-size:13px;margin-top:28px}
`;

export function Layout(p: { title: string; description?: string; head?: Child; children: Child }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{p.title}</title>
        <link rel="icon" href="data:," />
        {p.description ? <meta name="description" content={p.description} /> : null}
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        {p.head}
      </head>
      <body>
        <main>{p.children}</main>
      </body>
    </html>
  );
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
