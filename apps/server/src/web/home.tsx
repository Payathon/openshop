/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";

// OpenShop's own homepage at /, laid out after shopify.com: a dark page of large light
// headlines, rounded panels stacked on each other, and real screens of the product. Pictures
// are screenshots of the demo shops and workbench, shipped with the workbench under
// /admin/home/ (see docs/dev-notes.md). Demo shops are linked only where they exist.

export interface DemoShop {
  slug: string;
  name: string;
  blurb: string;
  image: string;
  url: string;
}


// The demo shops from seed-accounts.ts, with what to say about each.
export const DEMO_SHOPS = [
  { slug: "moon-nail", blurb: "一人美甲工作室，顾客在线选时间预约。用“简约”模板。", image: "/admin/home/phone-minimal.jpg" },
  { slug: "baiyi", blurb: "原创服装小品牌，按尺码和库存卖，发快递。用“服装”模板。", image: "/admin/home/phone-fashion.jpg" },
  { slug: "xiangkou", blurb: "巷子里的家常菜馆，订座、订套餐，也卖自家辣椒酱。用“餐厅”模板。", image: "/admin/home/phone-dining.jpg" },
];

const CSS = `
:root{--bg:#050807;--panel:#0b1411;--panel-2:#0f1d18;--violet:#150d33;--fg:#fff;--muted:rgba(255,255,255,.66);--dim:rgba(255,255,255,.42);--line:rgba(255,255,255,.12);--accent:#5ee39b;--font:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;color-scheme:dark}
*{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 var(--font)}
img{display:block;max-width:100%;height:auto}
a{color:inherit}
h1,h2,h3{margin:0;font-weight:400;letter-spacing:-.02em;text-wrap:balance}
p{margin:0}
.wrap{max-width:1120px;margin:0 auto;padding-inline:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 26px;border-radius:999px;border:1.5px solid #fff;font-size:16px;font-weight:500;text-decoration:none;white-space:nowrap}
.btn.solid{background:#fff;color:#000}
.btn.small{min-height:40px;padding:0 18px;font-size:15px}
.btn:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}

/* nav */
.nav{position:sticky;top:0;z-index:10;background:rgba(5,8,7,.78);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px)}
.nav .wrap{display:flex;align-items:center;gap:28px;min-height:68px}
.logo{display:flex;align-items:center;gap:8px;font-weight:700;font-size:20px;letter-spacing:-.01em;text-decoration:none}
.logo svg{width:28px;height:28px}
.links{display:flex;gap:26px;font-size:15px;color:var(--muted)}
.links a{text-decoration:none}.links a:hover{color:#fff}
.nav-end{margin-left:auto;display:flex;align-items:center;gap:20px;font-size:15px}
.nav-end>a:not(.btn){text-decoration:none;color:var(--muted)}

/* hero */
.hero{position:relative;overflow:hidden;padding-block:72px 0}
.hero::before{content:"";position:absolute;inset:-20% -10% auto auto;width:70%;height:120%;background:radial-gradient(closest-side,rgba(94,227,155,.16),transparent);pointer-events:none}
.hero .wrap{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:40px;align-items:center}
.hero h1{font-size:clamp(40px,5.4vw,72px);line-height:1.1;font-weight:300;letter-spacing:-.035em}
.hero h1 span{display:block;white-space:nowrap}
.hero p{margin-top:24px;max-width:28em;font-size:19px;color:var(--muted)}
.ctas{display:flex;flex-wrap:wrap;gap:14px;margin-top:34px}
.phones{position:relative;height:600px}
.phone{position:absolute;width:250px;border-radius:38px;padding:9px;background:#1b1d1c;box-shadow:0 30px 80px rgba(0,0,0,.6),inset 0 0 0 1.5px rgba(255,255,255,.12)}
.phone img{border-radius:30px;aspect-ratio:390/780;object-fit:cover;object-position:top;width:100%}
.phone.p1{left:0;top:70px;transform:rotate(-6deg)}
.phone.p2{left:50%;top:0;transform:translateX(-50%);z-index:2}
.phone.p3{right:0;top:90px;transform:rotate(6deg)}

/* panels */
.panel{position:relative;border-radius:40px 40px 0 0;margin-top:-40px;padding-block:110px}
.panel.green{background:linear-gradient(var(--panel),var(--bg))}
.panel.violet{background:linear-gradient(var(--violet),#070512)}
.panel.deep{background:linear-gradient(var(--panel-2),#06100c)}
.panel.ink{background:#0c0d0f}
.big{font-size:clamp(34px,5vw,60px);line-height:1.12;font-weight:300;letter-spacing:-.03em;max-width:17em}
.big .d{color:var(--dim)}
.lede{margin-top:20px;max-width:34em;font-size:18px;color:var(--muted)}

/* three cards under the "everywhere" headline */
.trio{display:grid;grid-template-columns:1.25fr .8fr 1.25fr;gap:16px;margin-top:64px}
.shot{position:relative;border-radius:20px;overflow:hidden;min-height:340px;background:#14201b;display:grid;place-items:center;padding:24px 24px 56px}
.shot.a{background:linear-gradient(160deg,#2e3b52,#151c28)}
.shot.b{background:linear-gradient(160deg,#5a1d63,#26102e)}
.shot.c{background:linear-gradient(160deg,#173d33,#0e1f1a)}
.shot .mini{width:150px;border-radius:24px;padding:6px;background:#111;box-shadow:0 20px 40px rgba(0,0,0,.5)}
.shot .mini img{border-radius:19px}
.shot figcaption{position:absolute;left:18px;bottom:16px;font-size:14px;color:rgba(255,255,255,.82)}
.bubble{max-width:250px;border-radius:18px;padding:12px 16px;font-size:14px;line-height:1.55}
.bubble.me{background:#fff;color:#111;border-bottom-right-radius:6px;justify-self:end}
.bubble.ai{background:rgba(255,255,255,.1);color:#fff;border-bottom-left-radius:6px;justify-self:start}
.paid{width:100%;max-width:250px;border-radius:18px;background:#fff;color:#111;padding:22px;display:grid;gap:6px;text-align:center}
.paid .tick{width:44px;height:44px;margin:0 auto 6px;border-radius:50%;background:#1677ff;display:grid;place-items:center}
.paid strong{font-size:28px;font-weight:600;letter-spacing:-.02em}
.paid span{font-size:13px;color:#666}

/* AI ordering card */
.chatcard{margin-top:72px;border-radius:24px;background:linear-gradient(135deg,#123128,#0a1714);border:1px solid var(--line);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px;padding:48px;align-items:center}
.chatcard h3{font-size:clamp(30px,3.6vw,44px);line-height:1.15;font-weight:300}
.chatcard p{margin-top:18px;color:var(--muted);max-width:28em}
.chat{display:grid;gap:12px;background:rgba(0,0,0,.28);border-radius:20px;padding:22px;border:1px solid var(--line)}
.chat .bubble{max-width:88%}
.paylink{display:inline-block;margin-top:8px;padding:6px 14px;border-radius:999px;background:#1677ff;color:#fff;font-size:13px}
.chat-input{margin-top:6px;border-radius:999px;border:1px solid var(--line);padding:10px 16px;font-size:14px;color:var(--dim)}

/* features */
.features{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:64px}
.feature{display:grid;gap:12px;align-content:start}
.feature .art{border-radius:20px;height:300px;overflow:hidden;background:#101a16;position:relative}
.feature h3{font-size:20px;margin-top:10px}
.feature p{color:var(--muted);font-size:15px;max-width:24em}
.art.thumbs{display:flex;gap:10px;align-items:flex-end;justify-content:center;padding:28px 18px 0;background:linear-gradient(180deg,#1b2a24,#0e1713)}
.art.thumbs img{width:31%;border-radius:12px 12px 0 0}
.art.thumbs img:nth-child(2){transform:translateY(-22px)}
.art.pair{display:flex;gap:14px;justify-content:center;padding:26px 18px 0;background:linear-gradient(180deg,#22302a,#0e1713)}
.art.pair img{width:46%;border-radius:16px 16px 0 0;object-fit:cover;object-position:top}
.art.admin img{position:absolute;left:24px;top:28px;width:620px;max-width:none;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.5)}

/* templates */
.temps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px;margin-top:56px}
.temp{display:grid;gap:10px}
.temp img{border-radius:18px;border:1px solid var(--line);aspect-ratio:3/4;object-fit:cover;object-position:top;width:100%}
.temp strong{font-weight:500}
.temp span{font-size:14px;color:var(--muted)}

/* demo shops */
.shops{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:56px}
.shopcard{display:grid;gap:12px;text-decoration:none}
.shopcard img{border-radius:20px;aspect-ratio:4/5;object-fit:cover;object-position:top;width:100%;border:1px solid var(--line)}
.shopcard h3{font-size:19px}
.shopcard p{font-size:15px;color:var(--muted)}
.shopcard .go{font-size:15px;color:var(--accent)}
.note{margin-top:28px;font-size:14px;color:var(--dim)}

/* pricing */
.plans{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:56px;max-width:880px}
.plan{border-radius:24px;border:1px solid var(--line);padding:32px;display:grid;gap:16px;align-content:start;background:rgba(255,255,255,.02)}
.plan.main{background:linear-gradient(160deg,#143a2d,#0b1914);border-color:rgba(94,227,155,.35)}
.plan h3{font-size:20px}
.plan .price{font-size:48px;font-weight:300;letter-spacing:-.03em;line-height:1}
.plan .price small{font-size:16px;color:var(--muted);letter-spacing:0;margin-left:6px}
.plan ul{margin:0;padding:0;list-style:none;display:grid;gap:10px;color:var(--muted);font-size:15px}
.plan li{display:flex;gap:10px}
.plan li::before{content:"";flex:0 0 6px;height:6px;margin-top:9px;border-radius:50%;background:var(--accent)}
.plan.soon li::before{background:var(--dim)}
.stat{border-left:2px solid var(--accent);padding-left:16px;margin-top:40px;max-width:30em;color:var(--muted)}
.stat strong{display:block;color:#fff;font-weight:400;font-size:20px;margin-bottom:4px}

/* steps */
.build{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:56px;align-items:center;margin-top:64px}
.build-pics{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.build-pics img{border-radius:20px;border:1px solid var(--line);aspect-ratio:3/4;object-fit:cover;object-position:top;width:100%}
.build-pics img:nth-child(2){margin-top:48px}
.steps{list-style:none;margin:0;padding:0;display:grid}
.steps li{display:grid;grid-template-columns:52px 1fr;align-items:baseline;padding:18px 0;border-bottom:1px solid var(--line)}
.steps li:last-child{border-bottom:0}
.steps b{color:var(--accent);font-weight:400;font-size:18px;font-variant-numeric:tabular-nums}
.steps span{font-size:clamp(24px,3vw,34px);font-weight:300;letter-spacing:-.02em;line-height:1.25}
.steps small{display:block;grid-column:2;margin-top:6px;font-size:15px;color:var(--muted);letter-spacing:0}
.center{text-align:center}
.center .big{margin-inline:auto}

/* footer */
footer{background:#000;padding-block:72px 40px}
.cols{display:grid;grid-template-columns:1.2fr repeat(3,minmax(0,1fr));gap:32px}
.cols h4{margin:0 0 14px;font-size:16px;font-weight:500}
.cols ul{margin:0;padding:0;list-style:none;display:grid;gap:10px;font-size:15px;color:var(--muted)}
.cols a{text-decoration:none}.cols a:hover{color:#fff}
.legal{margin-top:56px;padding-top:24px;border-top:1px solid var(--line);font-size:14px;color:var(--dim);display:flex;flex-wrap:wrap;gap:8px 24px}

@media (max-width:900px){
  .links,.nav-end>a:not(.btn){display:none}
  .hero{padding-top:44px}
  .hero .wrap{grid-template-columns:1fr}
  .phones{height:430px;margin-inline:-20px}
  .phone{width:180px;border-radius:30px;padding:7px}
  .phone img{border-radius:24px}
  .phone.p1{left:2%}.phone.p3{right:2%}
  .panel{padding-block:84px;border-radius:28px 28px 0 0;margin-top:-28px}
  .trio,.features,.shops{grid-template-columns:1fr}
  .shot{min-height:300px}
  .chatcard{grid-template-columns:1fr;padding:28px 22px;gap:28px}
  .temps{grid-template-columns:repeat(2,minmax(0,1fr))}
  .plans,.build{grid-template-columns:1fr}
  .cols{grid-template-columns:1fr 1fr}
  .cols>div:first-child{grid-column:1/-1}
}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`;

// A shopping bag with a spark: OpenShop's mark.
const Mark = (p: { color?: string }) => (
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <rect x="3" y="9" width="26" height="21" rx="6" fill={p.color ?? "#5ee39b"} />
    <path d="M11 12V9a5 5 0 0 1 10 0v3" stroke={p.color ?? "#5ee39b"} stroke-width="2.6" fill="none" stroke-linecap="round" />
    <path d="M16 15.5l1.5 3.6 3.6 1.4-3.6 1.4L16 25.5l-1.5-3.6-3.6-1.4 3.6-1.4z" fill="#04140d" />
  </svg>
);

const img = (name: string) => `/admin/home/${name}`;

const Section = (p: { id?: string; tone: string; children: Child }) => (
  <section id={p.id} class={`panel ${p.tone}`}>
    <div class="wrap">{p.children}</div>
  </section>
);

export function HomePage(p: { shops: DemoShop[] }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>OpenShop：开一家 AI 也能下单的店</title>
        <meta name="description" content="填一张表就有自己的店铺网站。顾客可以在微信里下单，也可以让 AI 助手替他预约、购买。免费开店。" />
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='9' width='26' height='21' rx='6' fill='%235ee39b'/%3E%3C/svg%3E" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header class="nav">
          <div class="wrap">
            <a class="logo" href="/">
              <Mark />
              OpenShop
            </a>
            <nav class="links" aria-label="主导航">
              <a href="#features">功能</a>
              <a href="#templates">模板</a>
              {p.shops.length ? <a href="#shops">示例店铺</a> : null}
              <a href="#pricing">收费</a>
            </nav>
            <div class="nav-end">
              <a href="/admin/login">登录</a>
              <a class="btn solid small" href="/admin/register">
                免费开店
              </a>
            </div>
          </div>
        </header>

        <section class="hero">
          <div class="wrap">
            <div>
              <h1>
                <span>开一家</span>
                <span>AI 也能下单的店</span>
              </h1>
              <p>填一张表，就有自己的店铺网站。顾客可以在微信里打开下单，也可以让 AI 助手替他预约、购买。用支付宝收款。</p>
              <div class="ctas">
                <a class="btn solid" href="/admin/register">
                  免费开店
                </a>
                <a class="btn" href={p.shops.length ? "#shops" : "#templates"}>
                  {p.shops.length ? "看看示例店" : "看看模板"}
                </a>
              </div>
            </div>
            <div class="phones" aria-hidden="true">
              <div class="phone p1">
                <img src={img("phone-fashion.jpg")} alt="" width={390} height={780} />
              </div>
              <div class="phone p2">
                <img src={img("phone-minimal.jpg")} alt="" width={390} height={780} />
              </div>
              <div class="phone p3">
                <img src={img("phone-dining.jpg")} alt="" width={390} height={780} />
              </div>
            </div>
          </div>
        </section>

        <Section tone="green">
          <h2 class="big">
            <span class="d">顾客在哪里，店就开到哪里。微信群、朋友圈、小红书，</span>还有 AI 助手的对话里。
          </h2>
          <div class="trio">
            <figure class="shot a" style="margin:0">
              <div class="mini">
                <img src={img("phone-beauty.jpg")} alt="手机上的店铺网站" width={390} height={780} loading="lazy" />
              </div>
              <figcaption>一个链接，手机上直接下单</figcaption>
            </figure>
            <figure class="shot b" style="margin:0;align-content:center;gap:10px">
              <p class="bubble me">帮我约周六下午做个法式</p>
              <p class="bubble ai">14:00 可以，¥168，我来下单</p>
              <figcaption>AI 助手替顾客下单</figcaption>
            </figure>
            <figure class="shot c" style="margin:0">
              <div class="paid">
                <div class="tick">
                  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </div>
                <span>支付宝付款成功</span>
                <strong>¥168.00</strong>
                <span>满月美甲工作室 · 法式微笑美甲</span>
              </div>
              <figcaption>支付宝收款，钱进你的账户</figcaption>
            </figure>
          </div>

          <div class="chatcard">
            <div>
              <h3>你的店，走进了对话框</h3>
              <p>每家店都自带 MCP 和 Skill。顾客对 Claude 这样的 AI 助手说一句“帮我约周六下午”，助手会自己查空闲时间、下单，再把付款链接发给他。你什么都不用做，订单直接出现在后台。</p>
            </div>
            <div class="chat" aria-label="AI 助手下单的对话示例">
              <p class="bubble me">帮我在满月美甲约这周六下午做个法式，裸粉色</p>
              <p class="bubble ai">周六下午有 14:00、15:30 和 17:00。法式微笑美甲 ¥168，大约 90 分钟。约 14:00 吗？</p>
              <p class="bubble me">14:00</p>
              <p class="bubble ai">
                约好了，时段为你保留 15 分钟，付款后生效。
                <br />
                <span class="paylink">支付宝付款 ¥168</span>
              </p>
              <p class="chat-input">回复…</p>
            </div>
          </div>
        </Section>

        <Section id="features" tone="ink">
          <h2 class="big">
            做生意要用的，
            <br />
            都在一个地方
          </h2>
          <div class="features">
            <div class="feature">
              <div class="art thumbs">
                <img src={img("phone-minimal.jpg")} alt="" width={390} height={780} loading="lazy" />
                <img src={img("phone-fashion.jpg")} alt="" width={390} height={780} loading="lazy" />
                <img src={img("phone-dining.jpg")} alt="" width={390} height={780} loading="lazy" />
              </div>
              <h3>填一张表就有一家店</h3>
              <p>选行业和模板，填上店名和电话，马上就有一家带示例商品的店。换成你的商品，发布就能卖。</p>
            </div>
            <div class="feature">
              <div class="art admin">
                <img src={img("admin.jpg")} alt="商家后台首页" width={1280} height={800} loading="lazy" />
              </div>
              <h3>一个后台管所有事</h3>
              <p>订单、商品、预约时间、库存和顾客都在一个后台里，手机上也能处理。改了的内容先预览，确认后一键发布。</p>
            </div>
            <div class="feature">
              <div class="art pair">
                <img src={img("product-booking.jpg")} alt="预约服务的下单页：选日期和时间" width={390} height={780} loading="lazy" />
                <img src={img("product-shipping.jpg")} alt="快递商品的下单页：选尺码和数量" width={390} height={780} loading="lazy" />
              </div>
              <h3>预约和快递都能卖</h3>
              <p>美甲、理发、私教按时段预约，满了自动不让约；衣服、零食按规格和库存卖，发快递。顾客取消时按你定的规则自动退款。</p>
            </div>
          </div>
        </Section>

        <Section id="templates" tone="violet">
          <h2 class="big">四个模板，随时换</h2>
          <p class="lede">开店时按行业推荐一个。之后在后台换模板，商品和内容都不会变。主色、字体和圆角也能自己调。</p>
          <div class="temps">
            {[
              ["minimal", "简约", "黑白配色、大留白，什么店都合适"],
              ["fashion", "服装", "满屏大图和竖版商品图"],
              ["dining", "餐厅", "菜单式价目表，营业时间放在显眼处"],
              ["beauty", "美业", "柔和的色块和圆角卡片"],
            ].map(([key, label, text]) => (
              <div class="temp">
                <img src={`/admin/templates/${key}.jpg`} alt={`${label}模板`} width={390} height={520} loading="lazy" />
                <strong>{label}</strong>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </Section>

        {p.shops.length ? (
          <Section id="shops" tone="ink">
            <h2 class="big">从一个人的小店开始</h2>
            <div class="shops">
              {p.shops.map((s) => (
                <a class="shopcard" href={s.url}>
                  <img src={s.image} alt={`${s.name}的店铺首页`} width={390} height={780} loading="lazy" />
                  <h3>{s.name}</h3>
                  <p>{s.blurb}</p>
                  <span class="go">去店里逛逛 →</span>
                </a>
              ))}
            </div>
            <p class="note">这些是用 OpenShop 搭的示例店铺，可以真的下单试试，付款是模拟的，不会扣钱。</p>
          </Section>
        ) : null}

        <Section id="pricing" tone="deep">
          <h2 class="big">开店免费</h2>
          <div class="plans">
            <div class="plan main">
              <h3>免费版</h3>
              <p class="price">
                ¥0<small>不限时间</small>
              </p>
              <ul>
                <li>店铺网站和全部四个模板</li>
                <li>预约服务和快递商品</li>
                <li>顾客的 AI 助手下单（MCP 和 Skill）</li>
                <li>支付宝收款，自动退款</li>
                <li>商家后台，手机上也能用</li>
              </ul>
              <a class="btn solid" href="/admin/register">
                免费开店
              </a>
            </div>
            <div class="plan soon">
              <h3>专业版</h3>
              <p class="price">
                即将推出<small></small>
              </p>
              <ul>
                <li>自定义域名</li>
                <li>去掉 OpenShop 标识</li>
                <li>更多次数的 AI 改店</li>
                <li>更多高级模块</li>
              </ul>
            </div>
          </div>
          <p class="stat">
            <strong>AI 助手下单永远免费</strong>
            顾客的 AI 助手来你店里下单，不收你任何额外费用。
          </p>
        </Section>

        <Section tone="ink">
          <div class="center">
            <h2 class="big">三步开店</h2>
          </div>
          <div class="build">
            <div class="build-pics" aria-hidden="true">
              <img src={img("onboarding.jpg")} alt="" width={390} height={520} loading="lazy" />
              <img src={img("phone-beauty.jpg")} alt="" width={390} height={780} loading="lazy" />
            </div>
            <div>
              <ol class="steps">
                <li>
                  <b>01</b>
                  <span>
                    选行业和模板
                    <small>美甲、餐饮、服装……选一个最接近的。</small>
                  </span>
                </li>
                <li>
                  <b>02</b>
                  <span>
                    换上你的商品
                    <small>价格、时长、规格和照片，改完先预览。</small>
                  </span>
                </li>
                <li>
                  <b>03</b>
                  <span>
                    发布，把链接发出去
                    <small>发到微信群和朋友圈，顾客的 AI 助手也能找到你。</small>
                  </span>
                </li>
              </ol>
              <div class="ctas">
                <a class="btn solid" href="/admin/register">
                  免费开店
                </a>
              </div>
            </div>
          </div>
        </Section>

        <footer>
          <div class="wrap">
            <div class="cols">
              <div>
                <a class="logo" href="/">
                  <Mark />
                  OpenShop
                </a>
              </div>
              <div>
                <h4>产品</h4>
                <ul>
                  <li>
                    <a href="#features">功能</a>
                  </li>
                  <li>
                    <a href="#templates">模板</a>
                  </li>
                  <li>
                    <a href="#pricing">收费</a>
                  </li>
                </ul>
              </div>
              <div>
                <h4>开始</h4>
                <ul>
                  <li>
                    <a href="/admin/register">免费开店</a>
                  </li>
                  <li>
                    <a href="/admin/login">商家登录</a>
                  </li>
                </ul>
              </div>
              <div>
                <h4>示例店铺</h4>
                <ul>
                  {p.shops.length ? (
                    p.shops.map((s) => (
                      <li>
                        <a href={s.url}>{s.name}</a>
                      </li>
                    ))
                  ) : (
                    <li>即将上线</li>
                  )}
                </ul>
              </div>
            </div>
            <p class="legal">
              <span>© 2026 OpenShop</span>
              <span>PAYATHON 2026 参赛作品</span>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
