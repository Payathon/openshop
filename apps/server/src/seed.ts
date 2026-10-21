import type { ProductInput } from "@openshop/core";
import type { OpenShop } from "./shop.ts";
import { Studio } from "./studio.ts";

// Two demo shops for local runs: a nail studio (booking) and a bakery (shipping), built the
// way merchants build theirs: edits in a changeset, then a publish that takes them live.
// Idempotent: does nothing once the nail studio exists. Returns merchant tokens it created.
export async function seedDemo(shop: OpenShop) {
  const exists = await shop.getShop("nail-studio").then(
    () => true,
    () => false,
  );
  if (exists) return null;
  const studio = new Studio(shop);

  const product = (p: Partial<ProductInput> & Pick<ProductInput, "name" | "fulfillment" | "variants">): ProductInput => ({
    description: "",
    images: [],
    durationMinutes: null,
    orderOptions: [],
    info: [],
    published: true,
    ...p,
  });

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
  const nailId = nail.shop.id;
  const color = { key: "color", label: "颜色", type: "choice" as const, choices: ["裸粉", "酒红", "奶白", "到店再选"], required: true };
  for (const [name, minutes, priceFen] of [
    ["单色美甲", 60, 12800],
    ["法式美甲", 90, 16800],
    ["卸甲 + 基础护理", 30, 5800],
  ] as const) {
    await studio.propose(nailId, {
      kind: "product.create",
      product: product({
        name,
        fulfillment: "booking",
        durationMinutes: minutes,
        orderOptions: name.startsWith("卸甲") ? [] : [color],
        info: [{ label: "时长", value: `约 ${minutes} 分钟` }],
        variants: [{ attributes: {}, priceFen, stock: null }],
      }),
    });
  }
  await studio.propose(nailId, { kind: "theme.update", patch: { font: "rounded", radius: "round" } });
  await studio.propose(nailId, { kind: "section.add", section: { id: "banner", type: "banner", props: { title: "新客首单 9 折", subtitle: "在线预约，到店即做" } }, index: 1 });
  await studio.publish(nailId);

  const bakery = await shop.createShop({
    slug: "bakery",
    name: "麦香烘焙",
    industry: "bakery",
    description: "手工曲奇和磅蛋糕，顺丰冷链发货。",
    phone: "13900000000",
  });
  const bakeryId = bakery.shop.id;
  await studio.propose(bakeryId, {
    kind: "product.create",
    product: product({
      name: "黄油曲奇",
      description: "法国发酵黄油，每盒独立包装。",
      fulfillment: "shipping",
      orderOptions: [{ key: "note", label: "贺卡留言", type: "text", required: false }],
      info: [
        { label: "保质期", value: "15 天" },
        { label: "过敏原", value: "含麸质、乳制品" },
      ],
      variants: [
        { attributes: { 规格: "小盒 12 片" }, priceFen: 3800, stock: 20 },
        { attributes: { 规格: "大盒 30 片" }, priceFen: 6800, stock: 10 },
      ],
    }),
  });
  await studio.propose(bakeryId, { kind: "theme.update", patch: { primary: "#b45309" } });
  await studio.propose(bakeryId, { kind: "section.add", section: { id: "banner", type: "banner", props: { title: "满 99 包邮", subtitle: "当天现烤，次日发货" } }, index: 1 });
  await studio.publish(bakeryId);

  return { "nail-studio": nail.merchantToken, bakery: bakery.merchantToken };
}
