import type { WeeklyHours } from "./availability.ts";
import type { ProductInput } from "./catalog.ts";
import { parsePage, type PageConfig, type Theme } from "./page.ts";

// What a new shop starts with (product-decisions #6): the merchant picks an industry and the
// modules they want, and gets a working site with sample content to replace.

// Optional modules. 店铺信息 and 联系方式 are always on; 预约 brings opening hours with it.
export const MODULES = {
  booking: "预约",
  shopping: "购买",
  banner: "推广横幅",
  gallery: "相册",
  text: "图文介绍",
} as const;
export type Module = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as Module[];

export interface OpeningHours {
  weekly: WeeklyHours[];
  capacity: number;
  stepMinutes: number;
}

export interface IndustryTemplate {
  key: string;
  label: string;
  modules: Module[];
  theme: Partial<Theme>;
  // Used when the booking module is on.
  hours: OpeningHours;
  cancelHours: number;
  productsTitle: string;
  banner: { title: string; subtitle: string };
  text: { title: string; body: string };
  // Sample products, flagged as samples when created; filtered by the chosen modules.
  samples: ProductInput[];
}

const days = (weekdays: number[], open: string, close: string) => weekdays.map((weekday) => ({ weekday, open, close }));
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const NOT_MONDAY = [0, 2, 3, 4, 5, 6];

const booking = (name: string, minutes: number, priceFen: number, extra: Partial<ProductInput> = {}): ProductInput => ({
  name,
  description: "",
  images: [],
  fulfillment: "booking",
  durationMinutes: minutes,
  orderOptions: [],
  info: [{ label: "时长", value: `约 ${minutes} 分钟` }],
  variants: [{ attributes: {}, priceFen, stock: null }],
  published: true,
  ...extra,
});

const shipping = (name: string, variants: [string, number][], extra: Partial<ProductInput> = {}): ProductInput => ({
  name,
  description: "",
  images: [],
  fulfillment: "shipping",
  durationMinutes: null,
  orderOptions: [],
  info: [],
  variants: variants.map(([label, priceFen]) => ({ attributes: label ? { 规格: label } : {}, priceFen, stock: 20 })),
  published: true,
  ...extra,
});

export const TEMPLATES: Record<string, IndustryTemplate> = {
  nail: {
    key: "nail",
    label: "美甲美睫",
    modules: ["booking", "banner", "gallery"],
    theme: { primary: "#d6336c", font: "rounded", radius: "round" },
    hours: { weekly: days(NOT_MONDAY, "10:00", "20:00"), capacity: 1, stepMinutes: 30 },
    cancelHours: 24,
    productsTitle: "服务项目",
    banner: { title: "新客首单 9 折", subtitle: "在线预约，到店即做" },
    text: { title: "关于我们", body: "一人工作室，全程一对一服务。" },
    samples: [
      booking("单色美甲", 60, 12800, {
        orderOptions: [{ key: "color", label: "颜色", type: "choice", choices: ["裸粉", "酒红", "奶白", "到店再选"], required: true }],
      }),
      booking("法式美甲", 90, 16800),
      booking("卸甲 + 基础护理", 30, 5800),
    ],
  },
  hair: {
    key: "hair",
    label: "理发造型",
    modules: ["booking", "banner", "text"],
    theme: { primary: "#1f6feb", font: "system", radius: "soft" },
    hours: { weekly: days(EVERY_DAY, "10:00", "21:00"), capacity: 2, stepMinutes: 30 },
    cancelHours: 2,
    productsTitle: "服务项目",
    banner: { title: "工作日剪发 8 折", subtitle: "周一至周五 10:00–17:00" },
    text: { title: "发型师", body: "从业 8 年，擅长短发和日系层次。" },
    samples: [
      booking("洗剪吹", 45, 8800, {
        orderOptions: [{ key: "stylist", label: "发型师", type: "choice", choices: ["店长", "资深发型师"], required: true }],
      }),
      booking("染发", 120, 39800),
      booking("烫发", 150, 49800),
    ],
  },
  fitness: {
    key: "fitness",
    label: "私教健身",
    modules: ["booking", "text"],
    theme: { primary: "#ea580c", font: "system", radius: "square" },
    hours: { weekly: days(EVERY_DAY, "07:00", "22:00"), capacity: 1, stepMinutes: 60 },
    cancelHours: 12,
    productsTitle: "课程",
    banner: { title: "体验课 ¥99", subtitle: "第一次上课先做体态评估" },
    text: { title: "教练简介", body: "国家职业资格认证健身教练，专注减脂和体态矫正。" },
    samples: [booking("私教体验课", 60, 9900), booking("私教课", 60, 30000), booking("体态评估", 30, 0)],
  },
  photo: {
    key: "photo",
    label: "摄影写真",
    modules: ["booking", "gallery", "text"],
    theme: { primary: "#111827", font: "serif", radius: "square" },
    hours: { weekly: days(EVERY_DAY, "09:00", "18:00"), capacity: 1, stepMinutes: 60 },
    cancelHours: 48,
    productsTitle: "拍摄套餐",
    banner: { title: "毕业季写真", subtitle: "含妆造和 20 张精修" },
    text: { title: "拍摄须知", body: "请提前 15 分钟到店化妆。底片当天拷贝，精修 7 天内交付。" },
    samples: [booking("证件照", 30, 9900), booking("个人写真", 120, 59900), booking("情侣写真", 180, 99900)],
  },
  bakery: {
    key: "bakery",
    label: "烘焙零售",
    modules: ["shopping", "banner", "text"],
    theme: { primary: "#b45309", font: "rounded", radius: "soft" },
    hours: { weekly: days(EVERY_DAY, "09:00", "18:00"), capacity: 1, stepMinutes: 30 },
    cancelHours: 24,
    productsTitle: "在售商品",
    banner: { title: "满 99 包邮", subtitle: "当天现烤，次日发货" },
    text: { title: "关于我们", body: "家庭烘焙工作室，只用动物黄油。" },
    samples: [
      shipping("黄油曲奇", [["小盒", 3800], ["大盒", 6800]], { info: [{ label: "保质期", value: "15 天" }] }),
      shipping("磅蛋糕", [["", 5800]], { orderOptions: [{ key: "note", label: "贺卡留言", type: "text", required: false }] }),
    ],
  },
  generic: {
    key: "generic",
    label: "其他",
    modules: ["booking", "shopping", "banner", "text"],
    theme: {},
    hours: { weekly: days(EVERY_DAY, "09:00", "18:00"), capacity: 1, stepMinutes: 30 },
    cancelHours: 24,
    productsTitle: "商品与服务",
    banner: { title: "欢迎光临", subtitle: "在线预约和购买" },
    text: { title: "关于我们", body: "在这里介绍你的店。" },
    samples: [booking("到店服务", 60, 10000), shipping("示例商品", [["", 5000]])],
  },
};

export function templateFor(industry: string): IndustryTemplate {
  return TEMPLATES[industry] ?? TEMPLATES.generic!;
}

// The page for a template with the chosen modules, in a fixed, sensible order.
export function templatePage(t: IndustryTemplate, modules: Module[]): PageConfig {
  const on = new Set(modules);
  const sells = on.has("booking") || on.has("shopping");
  return parsePage({
    sections: [
      { id: "header", type: "header" },
      ...(on.has("banner") ? [{ id: "banner", type: "banner", props: t.banner }] : []),
      ...(sells ? [{ id: "products", type: "products", props: { title: t.productsTitle } }] : []),
      ...(on.has("booking") ? [{ id: "booking", type: "booking" }] : []),
      ...(on.has("text") ? [{ id: "text", type: "text", props: t.text }] : []),
      ...(on.has("gallery") ? [{ id: "gallery", type: "gallery" }] : []),
      { id: "contact", type: "contact" },
    ],
    theme: t.theme,
  });
}

// Sample products that fit the chosen modules: bookings need 预约, shipped goods need 购买.
export function templateSamples(t: IndustryTemplate, modules: Module[]): ProductInput[] {
  return t.samples.filter((p) => modules.includes(p.fulfillment === "booking" ? "booking" : "shopping"));
}
