import type { OpenShop } from "./shop.ts";

// Two demo shops for local runs: a nail studio (booking) and a bakery (shipping).
// Idempotent: does nothing once the nail studio exists. Returns merchant tokens it created.
export async function seedDemo(shop: OpenShop) {
  const exists = await shop.getShop("nail-studio").then(
    () => true,
    () => false,
  );
  if (exists) return null;

  const nail = await shop.createShop({
    slug: "nail-studio",
    name: "小美美甲工作室",
    industry: "nail",
    description: "日系美甲，一人工作室，需提前预约。",
    phone: "13800000000",
    address: "杭州市西湖区文三路 1 号 2 楼",
    schedule: {
      weekly: [0, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: "10:00", close: "20:00" })),
      capacity: 1,
      stepMinutes: 30,
      closures: [],
    },
    cancelPolicy: { freeCancelHoursBefore: 24 },
  });
  const nailId = (await shop.authenticate(nail.merchantToken))!;
  const color = { key: "color", label: "颜色", type: "choice" as const, choices: ["裸粉", "酒红", "奶白", "到店再选"], required: true };
  for (const [name, minutes, priceFen] of [
    ["单色美甲", 60, 12800],
    ["法式美甲", 90, 16800],
    ["卸甲 + 基础护理", 30, 5800],
  ] as const) {
    await shop.createProduct(nailId, {
      name,
      description: "",
      images: [],
      fulfillment: "booking",
      durationMinutes: minutes,
      orderOptions: name.startsWith("卸甲") ? [] : [color],
      info: [{ label: "时长", value: `约 ${minutes} 分钟` }],
      variants: [{ attributes: {}, priceFen, stock: null }],
      published: true,
    });
  }

  const bakery = await shop.createShop({
    slug: "bakery",
    name: "麦香烘焙",
    industry: "bakery",
    description: "手工曲奇和磅蛋糕，顺丰冷链发货。",
    phone: "13900000000",
  });
  const bakeryId = (await shop.authenticate(bakery.merchantToken))!;
  await shop.createProduct(bakeryId, {
    name: "黄油曲奇",
    description: "法国发酵黄油，每盒独立包装。",
    images: [],
    fulfillment: "shipping",
    durationMinutes: null,
    orderOptions: [{ key: "note", label: "贺卡留言", type: "text", required: false }],
    info: [
      { label: "保质期", value: "15 天" },
      { label: "过敏原", value: "含麸质、乳制品" },
    ],
    variants: [
      { attributes: { 规格: "小盒 12 片" }, priceFen: 3800, stock: 20 },
      { attributes: { 规格: "大盒 30 片" }, priceFen: 6800, stock: 10 },
    ],
    published: true,
  });

  return { "nail-studio": nail.merchantToken, bakery: bakery.merchantToken };
}
