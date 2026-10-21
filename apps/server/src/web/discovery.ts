import { fen, fenToYuan } from "@openshop/core";
import { price, variantLabel, WEEKDAYS, type PublicProduct, type PublicShop } from "./layout.tsx";

// What lets any agent order from a shop link without the OpenShop Skill
// (docs/tech-plan.md, "让任意 agent 都能发现这家店"): schema.org data in the page,
// a plain-text llms.txt, and a machine-readable openshop.json.

export interface ShopUrls {
  // The shop's web address, e.g. https://openshop.example/s/nail-studio
  shop: string;
  // The server root, for /mcp and /api.
  server: string;
}

const SCHEMA_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function jsonLd(shop: PublicShop, products: PublicProduct[], urls: ShopUrls) {
  return {
    "@context": "https://schema.org",
    // A shop with a schedule serves customers in person; one without only ships.
    "@type": shop.schedule ? "LocalBusiness" : "OnlineStore",
    name: shop.name,
    ...(shop.description ? { description: shop.description } : {}),
    url: urls.shop,
    telephone: shop.phone,
    ...(shop.address ? { address: { "@type": "PostalAddress", streetAddress: shop.address, addressCountry: "CN" } } : {}),
    ...(shop.schedule
      ? {
          openingHoursSpecification: shop.schedule.weekly.map((h) => ({
            "@type": "OpeningHoursSpecification",
            dayOfWeek: `https://schema.org/${SCHEMA_DAYS[h.weekday]}`,
            opens: h.open,
            closes: h.close,
          })),
        }
      : {}),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "商品与服务",
      itemListElement: products.flatMap((p) =>
        p.variants.map((v) => ({
          "@type": "Offer",
          price: fenToYuan(fen(v.priceFen)),
          priceCurrency: "CNY",
          url: `${urls.shop}/p/${p.id}`,
          availability: v.stock === 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
          itemOffered: {
            "@type": p.fulfillment === "booking" ? "Service" : "Product",
            name: [p.name, variantLabel(v.attributes)].filter(Boolean).join(" "),
            ...(p.description ? { description: p.description } : {}),
          },
        })),
      ),
    },
  };
}

export function llmsTxt(shop: PublicShop, products: PublicProduct[], urls: ShopUrls) {
  const lines = [`# ${shop.name}`, ""];
  if (shop.description) lines.push(`> ${shop.description}`, "");
  lines.push(`- 电话：${shop.phone}`);
  if (shop.address) lines.push(`- 地址：${shop.address}`);
  if (shop.schedule) {
    lines.push(`- 营业时间：${shop.schedule.weekly.map((h) => `${WEEKDAYS[h.weekday]} ${h.open}–${h.close}`).join("，")}`);
    lines.push(`- 取消规则：预约开始前 ${shop.cancelPolicy.freeCancelHoursBefore} 小时以上可免费取消并自动退款`);
  }
  lines.push("", "## 商品与服务", "");
  for (const p of products) {
    const how = p.fulfillment === "booking" ? `预约，约 ${p.durationMinutes} 分钟` : "快递发货";
    const prices = p.variants.map((v) => [variantLabel(v.attributes), price(v.priceFen)].filter(Boolean).join(" ")).join("；");
    const options = p.orderOptions
      .filter((o) => o.required)
      .map((o) => (o.type === "choice" ? `${o.label}（${o.choices.join("、")}）` : o.label));
    lines.push(`- [${p.name}](${urls.shop}/p/${p.id})（${how}）：${prices}${options.length ? `。下单时需要选择：${options.join("，")}` : ""}`);
  }
  lines.push(
    "",
    "## 如何下单",
    "",
    `- 网页：打开 ${urls.shop}，选好商品和时间，用支付宝付款。`,
    "- AI agent：用 OpenShop 命令行查询和下单，每条命令都输出 JSON 和下一步提示：",
    "",
    "  ```bash",
    `  npx -y openshop shop ${urls.shop}          # 店铺信息和全部商品`,
    `  npx -y openshop slots ${urls.shop} <variantId> --date YYYY-MM-DD`,
    `  npx -y openshop order ${urls.shop} --input '<json>'   # 返回支付宝付款链接`,
    "  ```",
    "",
    `- MCP（Streamable HTTP，无需登录）：${urls.server}/mcp，工具里的 shop 参数填 ${shop.slug} 或本店链接。`,
    "",
    "付款都在支付宝完成，必须由用户本人确认。下单前请先和用户确认商品、时间或地址、价格和联系方式。",
    "",
  );
  return lines.join("\n");
}

export function openshopJson(shop: PublicShop, urls: ShopUrls) {
  return {
    openshop: 1,
    shop: { id: shop.id, slug: shop.slug, name: shop.name },
    url: urls.shop,
    llms: `${urls.shop}/llms.txt`,
    mcp: { url: `${urls.server}/mcp`, transport: "streamable-http", shopArgument: shop.slug },
    api: `${urls.server}/api/s/${shop.slug}`,
    cli: `npx -y openshop shop ${urls.shop}`,
  };
}
