/** @jsxImportSource hono/jsx */
import type { Theme } from "@openshop/core";
import { Img, jsonForScript, Layout, PreviewBar, price, TitleBar, variantLabel, WEEKDAYS, type PublicProduct, type PublicShop } from "./layout.tsx";
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
  const prices = product.variants.map((v) => v.priceFen);
  const low = Math.min(...prices);
  // On phones the pictures scroll sideways above the details; on computers they sit in a
  // column to the left (first one large), with the details beside them.
  const media =
    product.images.length > 0 ? (
      <div class="media-wrap">
        <div class="media">
          {product.images.map((src, i) => (
            <Img src={src} alt={product.name} width={600} height={600} eager={i === 0} />
          ))}
        </div>
        {product.images.length > 1 ? <span class="media-count">共 {product.images.length} 张，左右滑动</span> : null}
      </div>
    ) : null;
  const layout = media ? "product" : "product no-media";
  const info = (
    <>
      <div class="pd">
        <p class="pd-vendor">{shop.name}</p>
        <h1>
          {product.name}
          {p.preview?.sample ? <span class="badge">示例</span> : null}
        </h1>
        <p class="price">{prices.some((x) => x !== low) ? `${price(low)} 起` : price(low)}</p>
        {product.description ? <p class="pd-desc">{product.description}</p> : null}
        {product.info.length > 0 ? (
          <dl class="facts">
            {product.info.map((i) => (
              <>
                <dt>{i.label}</dt>
                <dd>{i.value}</dd>
              </>
            ))}
          </dl>
        ) : null}
      </div>
    </>
  );

  if (p.preview) {
    return (
      <Layout title={`预览：${product.name} - ${shop.name}`} theme={p.theme} head={<meta name="robots" content="noindex" />}>
        <PreviewBar />
        <TitleBar shop={shop} home={urls.shop} back={urls.shop} />
        <div class={layout}>
          {media}
          <div class="product-info">
            {info}
            <div class="checkout">
              {product.variants.length > 1 ? (
                <div class="pills">
                  {product.variants.map((v) => (
                    <span class="pill">
                      {variantLabel(v.attributes)} · {price(v.priceFen)}
                    </span>
                  ))}
                </div>
              ) : null}
              <p class="hint">预览里不能下单。发布后，顾客在这里选{product.fulfillment === "booking" ? "时间" : "规格和数量"}并付款。</p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }
  const booking = product.fulfillment === "booking";
  const days = booking ? bookingDays(shop, p.now) : [];
  const single = product.variants.length === 1 && Object.keys(product.variants[0]!.attributes).length === 0;
  const variantName = single ? "" : Object.keys(product.variants[0]!.attributes).join(" / ") || "规格";
  const data = {
    fulfillment: product.fulfillment,
    availability: `${urls.server}/api/s/${shop.slug}/availability`,
    checkout: `${urls.shop}/checkout`,
    variants: product.variants.map((v) => ({ id: v.id, priceFen: v.priceFen })),
  };

  return (
    <Layout title={`${product.name} - ${shop.name}`} description={product.description || `${shop.name} 的 ${product.name}`} theme={p.theme}>
      <TitleBar shop={shop} home={urls.shop} back={urls.shop} />
      <div class={layout}>
        {media}
        <div class="product-info">
          {info}
          <form id="checkout" class="checkout">
            {single ? (
              <input type="hidden" name="variant" value={product.variants[0]!.id} />
            ) : (
              <fieldset>
                <legend>{variantName}</legend>
                <div class="pills">
                  {product.variants.map((v, i) => (
                    <label class="pill">
                      <input type="radio" name="variant" value={v.id} checked={i === 0} />
                      {variantLabel(v.attributes)}
                      {prices.some((x) => x !== low) ? <small>{price(v.priceFen)}</small> : null}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {product.orderOptions.map((o) =>
              o.type === "choice" ? (
                <fieldset>
                  <legend>
                    {o.label}
                    {o.required ? "" : "（选填）"}
                  </legend>
                  <div class="pills">
                    {o.choices.map((choice) => (
                      <label class="pill">
                        <input type="radio" name={`opt:${o.key}`} value={choice} required={o.required} />
                        {choice}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <label class="field">
                  <span>
                    {o.label}
                    {o.required ? "" : "（选填）"}
                  </span>
                  <input type="text" name={`opt:${o.key}`} maxlength={200} required={o.required} />
                </label>
              ),
            )}

            {booking ? (
              <>
                <fieldset>
                  <legend>日期</legend>
                  <div class="pills days">
                    {days.map((d) => (
                      <button type="button" class="pill" data-date={d.date} disabled={!d.open} title={d.open ? undefined : "不营业"}>
                        {d.name}
                        <small>{d.md}</small>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend>时间（约 {product.durationMinutes} 分钟）</legend>
                  <div class="pills" id="slots">
                    <span class="muted small">先选一个日期</span>
                  </div>
                  <input type="hidden" name="slotStart" />
                </fieldset>
              </>
            ) : (
              <label class="field">
                <span>
                  数量 <span id="stock" class="small"></span>
                </span>
                <span class="qty">
                  <button type="button" data-step="-1" aria-label="减一件">
                    −
                  </button>
                  <input type="number" name="quantity" value="1" min="1" max="99" inputmode="numeric" required />
                  <button type="button" data-step="1" aria-label="加一件">
                    +
                  </button>
                </span>
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

            <p class="fine">
              {booking ? `时段为您保留 15 分钟，付款后预约生效。预约开始前 ${shop.cancelPolicy.freeCancelHoursBefore} 小时以上可免费取消。` : "库存为您保留 15 分钟，付款后店家发货。"}
            </p>
            <p class="error" id="error" role="alert"></p>
          </form>
          <div class="pay-bar">
            <p class="total">
              <span class="muted small">合计</span>
              <strong id="total" class="price">
                {price(product.variants[0]!.priceFen)}
              </strong>
            </p>
            <button type="submit" form="checkout" class="btn">
              {booking ? "预约并支付" : "去支付"}
            </button>
          </div>
        </div>
      </div>
      <script type="application/json" id="checkout-data" dangerouslySetInnerHTML={{ __html: jsonForScript(data) }} />
      <script dangerouslySetInnerHTML={{ __html: CHECKOUT_SCRIPT }} />
    </Layout>
  );
}
