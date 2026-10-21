/** @jsxImportSource hono/jsx */
import type { Theme } from "@openshop/core";
import { Img, jsonForScript, Layout, PreviewBar, price, variantLabel, WEEKDAYS, type PublicProduct, type PublicShop } from "./layout.tsx";
import type { ShopUrls } from "./discovery.ts";
import { CHECKOUT_SCRIPT } from "./scripts.ts";

// How far ahead customers can pick a booking date on the page.
const BOOKING_DAYS = 14;

// The next BOOKING_DAYS Beijing dates; closed weekdays are shown but disabled.
function bookingDays(shop: PublicShop, now: Date) {
  const open = new Set(shop.schedule?.weekly.map((h) => h.weekday));
  return Array.from({ length: BOOKING_DAYS }, (_, i) => {
    const d = new Date(now.getTime() + 8 * 3_600_000 + i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    const name = i === 0 ? "今天" : i === 1 ? "明天" : WEEKDAYS[d.getUTCDay()]!;
    return { date, name, md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, open: open.has(d.getUTCDay()) };
  });
}

export function ProductPage(p: {
  shop: PublicShop;
  product: PublicProduct;
  urls: ShopUrls;
  now: Date;
  theme: Theme;
  // Preview links show the product but can't take orders: it may not exist live yet.
  preview?: { sample: boolean } | undefined;
}) {
  const { shop, product, urls } = p;
  const head = (
    <>
      <p class="small">
        <a href={urls.shop}>← {shop.name}</a>
      </p>
      {product.images.length > 0 ? (
        <div class="photos">
          {product.images.map((src, i) => (
            <Img src={src} alt={product.name} width={480} height={360} eager={i === 0} />
          ))}
        </div>
      ) : null}
      <h1>
        {product.name}
        {p.preview?.sample ? <span class="badge">示例</span> : null}
      </h1>
      {product.description ? <p class="muted">{product.description}</p> : null}
      {product.info.length > 0 ? (
        <dl class="rows small">
          {product.info.map((i) => (
            <>
              <dt>{i.label}</dt>
              <dd>{i.value}</dd>
            </>
          ))}
        </dl>
      ) : null}
    </>
  );

  if (p.preview) {
    return (
      <Layout title={`预览：${product.name} - ${shop.name}`} theme={p.theme} head={<meta name="robots" content="noindex" />}>
        <PreviewBar />
        {head}
        <section class="card">
          {product.variants.map((v) => (
            <p class="price">
              {variantLabel(v.attributes) ? `${variantLabel(v.attributes)} · ` : ""}
              {price(v.priceFen)}
            </p>
          ))}
          <p class="muted small">预览里不能下单。发布后，顾客在这里选{product.fulfillment === "booking" ? "时间" : "规格和数量"}并付款。</p>
        </section>
      </Layout>
    );
  }
  const booking = product.fulfillment === "booking";
  const days = booking ? bookingDays(shop, p.now) : [];
  const single = product.variants.length === 1 && Object.keys(product.variants[0]!.attributes).length === 0;
  const data = {
    fulfillment: product.fulfillment,
    availability: `${urls.server}/api/s/${shop.slug}/availability`,
    checkout: `${urls.shop}/checkout`,
    variants: product.variants.map((v) => ({ id: v.id, priceFen: v.priceFen })),
  };

  return (
    <Layout title={`${product.name} - ${shop.name}`} description={product.description || `${shop.name} 的 ${product.name}`} theme={p.theme}>
      {head}

      <form id="checkout" class="card">
        <div class={single ? "" : "chips"} role={single ? undefined : "radiogroup"} aria-label="规格">
          {product.variants.map((v, i) =>
            single ? (
              <>
                <input type="hidden" name="variant" value={v.id} />
                <p class="price">{price(v.priceFen)}</p>
              </>
            ) : (
              <label class="chip">
                <input type="radio" name="variant" value={v.id} checked={i === 0} />
                {variantLabel(v.attributes)} · {price(v.priceFen)}
              </label>
            ),
          )}
        </div>

        {product.orderOptions.map((o) => (
          <div>
            <p class="label">
              {o.label}
              {o.required ? "" : "（选填）"}
            </p>
            {o.type === "choice" ? (
              <div class="chips" role="radiogroup" aria-label={o.label}>
                {o.choices.map((choice) => (
                  <label class="chip">
                    <input type="radio" name={`opt:${o.key}`} value={choice} required={o.required} />
                    {choice}
                  </label>
                ))}
              </div>
            ) : (
              <input type="text" name={`opt:${o.key}`} maxlength={200} required={o.required} aria-label={o.label} />
            )}
          </div>
        ))}

        {booking ? (
          <>
            <p class="label">日期</p>
            <div class="days">
              {days.map((d) => (
                <button type="button" class="chip" data-date={d.date} disabled={!d.open} title={d.open ? undefined : "不营业"}>
                  {d.name}
                  <br />
                  <span class="small">{d.md}</span>
                </button>
              ))}
            </div>
            <p class="label">时间（约 {product.durationMinutes} 分钟）</p>
            <div class="chips" id="slots">
              <span class="muted small">先选一个日期</span>
            </div>
            <input type="hidden" name="slotStart" />
          </>
        ) : (
          <label class="field">
            <span>
              数量 <span id="stock" class="small"></span>
            </span>
            <input type="number" name="quantity" value="1" min="1" max="99" inputmode="numeric" required />
          </label>
        )}

        <label class="field">
          <span>{booking ? "怎么称呼您" : "收货人"}</span>
          <input type="text" name="customerName" maxlength={30} autocomplete="name" required />
        </label>
        <label class="field">
          <span>手机号</span>
          <input type="tel" name="phone" pattern="1[0-9]{10}" maxlength={11} inputmode="numeric" autocomplete="tel" required title="11 位手机号" />
        </label>
        {booking ? null : (
          <>
            <label class="field">
              <span>所在地区</span>
              <input type="text" name="region" maxlength={100} placeholder="省 市 区" autocomplete="address-level1" required />
            </label>
            <label class="field">
              <span>详细地址</span>
              <input type="text" name="detail" maxlength={200} placeholder="街道、门牌号" autocomplete="street-address" required />
            </label>
          </>
        )}

        <p class="error" id="error" role="alert"></p>
        <button type="submit" class="btn block">
          去支付
        </button>
        <p class="muted small" style="text-align:center;margin:10px 0 0">
          {booking ? `时段为您保留 15 分钟，付款后预约生效。预约开始前 ${shop.cancelPolicy.freeCancelHoursBefore} 小时以上可免费取消。` : "库存为您保留 15 分钟，付款后店家发货。"}
        </p>
      </form>
      <script type="application/json" id="checkout-data" dangerouslySetInnerHTML={{ __html: jsonForScript(data) }} />
      <script dangerouslySetInnerHTML={{ __html: CHECKOUT_SCRIPT }} />
    </Layout>
  );
}
