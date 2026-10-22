import { z } from "zod";
import {
  checkSections,
  PageConfigError,
  parseSection,
  parseTheme,
  productInputSchema,
  sectionLabel,
  STYLES,
  themeSchema,
  type CancelPolicy,
  type Fulfillment,
  type OpeningHours,
  type OrderOption,
  type PageConfig,
  type ProductInput,
  type Section,
  type Theme,
} from "@openshop/core";
import { phone, scheduleSchema } from "./schemas.ts";
import { ShopError } from "./shop.ts";

// A shop's content: everything customers see that the merchant edits through previews and
// publishing (docs/tech-plan.md, 预览与发布). Operational state (stock levels, closures,
// orders) is not content and changes immediately.
//
// Edits are Ops. applyOp is the only definition of what an edit does: the preview replays the
// open changeset's ops over live content, and publishing persists the result.

export interface ShopContent {
  name: string;
  description: string;
  phone: string;
  address: string | null;
  // Null for shops without bookings.
  hours: OpeningHours | null;
  cancelPolicy: CancelPolicy;
}

export interface VariantContent {
  id: string;
  attributes: Record<string, string>;
  priceFen: number;
  // Live stock for existing variants; an edit only sets the starting stock of new ones.
  stock: number | null;
}

export interface ProductContent {
  id: string;
  name: string;
  description: string;
  images: string[];
  fulfillment: Fulfillment;
  durationMinutes: number | null;
  orderOptions: OrderOption[];
  info: { label: string; value: string }[];
  published: boolean;
  sample: boolean;
  variants: VariantContent[];
}

export interface Content {
  shop: ShopContent;
  page: PageConfig;
  products: ProductContent[];
}

// ---- what clients and the merchant agent send ------------------------------------------

const hoursSchema = scheduleSchema.omit({ closures: true }).extend({ weekly: scheduleSchema.shape.weekly.min(1, "至少要有一天营业") });

const shopPatchSchema = z
  .object({
    name: z.string().min(1).max(50),
    description: z.string().max(2000),
    phone,
    address: z.string().max(200).nullable(),
    hours: hoursSchema.nullable(),
    cancelPolicy: z.object({ freeCancelHoursBefore: z.number().int().nonnegative().max(720) }),
  })
  .partial();

const sectionInput = z.object({
  type: z.string(),
  id: z.string().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
});

export const opInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shop.update"), patch: shopPatchSchema }),
  z.object({ kind: z.literal("theme.update"), patch: themeSchema.partial() }),
  // Without an index, a new section goes just above 联系方式.
  z.object({ kind: z.literal("section.add"), section: sectionInput, index: z.number().int().nonnegative().optional() }),
  z.object({ kind: z.literal("section.update"), id: z.string(), props: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal("section.move"), id: z.string(), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("section.remove"), id: z.string() }),
  z.object({ kind: z.literal("product.create"), product: productInputSchema }),
  z.object({ kind: z.literal("product.update"), id: z.string(), product: productInputSchema }),
  z.object({ kind: z.literal("product.delete"), id: z.string() }),
]);
export type OpInput = z.infer<typeof opInputSchema>;

// ---- what is stored: inputs with every new id assigned --------------------------------

export type Op =
  | { kind: "shop.update"; patch: Partial<ShopContent> }
  | { kind: "theme.update"; patch: Partial<Theme> }
  | { kind: "section.add"; section: Section; index: number }
  | { kind: "section.update"; id: string; props: Record<string, unknown> }
  | { kind: "section.move"; id: string; index: number }
  | { kind: "section.remove"; id: string }
  | { kind: "product.create"; product: ProductContent }
  | { kind: "product.update"; product: ProductContent }
  | { kind: "product.delete"; id: string };

// Ops on the same target build on each other; undoing one also undoes later ones on it.
export function opTarget(op: Op): string {
  switch (op.kind) {
    case "shop.update":
      return "shop";
    case "theme.update":
      return "theme";
    case "section.add":
      return `section:${op.section.id}`;
    case "product.create":
    case "product.update":
      return `product:${op.product.id}`;
    default:
      return `${op.kind.startsWith("section") ? "section" : "product"}:${op.id}`;
  }
}

const invalid = (message: string) => new ShopError(400, "invalid_change", message);

function findSection(c: Content, id: string) {
  const s = c.page.sections.find((x) => x.id === id);
  if (!s) throw new ShopError(404, "section_not_found", `找不到区块 ${id}`);
  return s;
}

function findProduct(c: Content, id: string) {
  const p = c.products.find((x) => x.id === id);
  if (!p) throw new ShopError(404, "product_not_found", "找不到这个商品");
  return p;
}

function checkProductShape(p: { fulfillment: Fulfillment; durationMinutes: number | null }) {
  if (p.fulfillment === "booking" && !p.durationMinutes) throw invalid("预约类商品需要填写服务时长（durationMinutes）");
}

function page(fn: () => PageConfig): PageConfig {
  try {
    const next = fn();
    checkSections(next.sections);
    return next;
  } catch (err) {
    if (err instanceof PageConfigError) throw invalid(err.message);
    throw err;
  }
}

const withSection = (sections: Section[], s: Section, index: number) => [...sections.slice(0, index), s, ...sections.slice(index)];

// Turns client input into a stored op against the current (preview) content: assigns ids and
// fills in what the client may leave out. Validation happens when the op is applied.
export function resolveOp(c: Content, input: OpInput, newId: (prefix: string) => string): Op {
  switch (input.kind) {
    case "shop.update":
    case "theme.update":
    case "section.update":
    case "section.move":
    case "section.remove":
    case "product.delete":
      return input as Op;
    case "section.add": {
      const contact = c.page.sections.findIndex((s) => s.type === "contact");
      const index = input.index ?? (contact === -1 ? c.page.sections.length : contact);
      const section = parseSectionInput({ ...input.section, id: input.section.id ?? newId("sec") });
      return { kind: "section.add", section, index };
    }
    case "product.create":
      return { kind: "product.create", product: fromInput(newId("prod"), input.product, [], newId, false) };
    case "product.update": {
      const old = findProduct(c, input.id);
      return { kind: "product.update", product: fromInput(old.id, input.product, old.variants, newId, false) };
    }
  }
}

function parseSectionInput(raw: unknown): Section {
  try {
    return parseSection(raw);
  } catch (err) {
    if (err instanceof PageConfigError) throw invalid(err.message);
    throw err;
  }
}

// Variants keep their ids by position, so order history and links stay stable.
export function fromInput(id: string, input: ProductInput, old: VariantContent[], newId: (prefix: string) => string, sample: boolean): ProductContent {
  return {
    id,
    name: input.name,
    description: input.description,
    images: input.images,
    fulfillment: input.fulfillment,
    durationMinutes: input.durationMinutes,
    orderOptions: input.orderOptions,
    info: input.info,
    published: input.published,
    sample,
    variants: input.variants.map((v, i) => ({
      id: old[i]?.id ?? newId("var"),
      attributes: v.attributes,
      priceFen: v.priceFen,
      stock: input.fulfillment === "shipping" ? (v.stock ?? 0) : null,
    })),
  };
}

export function applyOp(c: Content, op: Op): Content {
  switch (op.kind) {
    case "shop.update":
      return { ...c, shop: { ...c.shop, ...op.patch } };
    case "theme.update":
      return { ...c, page: page(() => ({ ...c.page, theme: parseTheme({ ...c.page.theme, ...op.patch }) })) };
    case "section.add": {
      if (c.page.sections.some((s) => s.id === op.section.id)) throw invalid(`区块 id 重复：${op.section.id}`);
      const s = parseSectionInput(op.section);
      return { ...c, page: page(() => ({ ...c.page, sections: withSection(c.page.sections, s, Math.min(op.index, c.page.sections.length)) })) };
    }
    case "section.update": {
      const old = findSection(c, op.id);
      const s = parseSectionInput({ ...old, props: { ...old.props, ...op.props } });
      return { ...c, page: page(() => ({ ...c.page, sections: c.page.sections.map((x) => (x.id === op.id ? s : x)) })) };
    }
    case "section.move": {
      const s = findSection(c, op.id);
      const rest = c.page.sections.filter((x) => x.id !== op.id);
      return { ...c, page: page(() => ({ ...c.page, sections: withSection(rest, s, Math.min(op.index, rest.length)) })) };
    }
    case "section.remove":
      findSection(c, op.id);
      return { ...c, page: page(() => ({ ...c.page, sections: c.page.sections.filter((x) => x.id !== op.id) })) };
    case "product.create":
      if (c.products.some((p) => p.id === op.product.id)) throw invalid(`商品 id 重复：${op.product.id}`);
      checkProductShape(op.product);
      return { ...c, products: [...c.products, op.product] };
    case "product.update": {
      const old = findProduct(c, op.product.id);
      checkProductShape(op.product);
      // Stock is operational: existing variants keep whatever stock they have now.
      const stockOf = new Map(old.variants.map((v) => [v.id, v.stock]));
      const product = {
        ...op.product,
        variants: op.product.variants.map((v) =>
          stockOf.has(v.id) && op.product.fulfillment === old.fulfillment ? { ...v, stock: stockOf.get(v.id)! } : v,
        ),
      };
      return { ...c, products: c.products.map((p) => (p.id === product.id ? product : p)) };
    }
    case "product.delete": {
      findProduct(c, op.id);
      // Sections that pointed at the product stop doing so.
      const sections = c.page.sections.map((s): Section => {
        if (s.type === "banner" && s.props.productId === op.id) return { ...s, props: { ...s.props, productId: null } };
        if (s.type === "products" && Array.isArray(s.props.productIds)) {
          return { ...s, props: { ...s.props, productIds: s.props.productIds.filter((id) => id !== op.id) } };
        }
        return s;
      });
      return { ...c, page: { ...c.page, sections }, products: c.products.filter((p) => p.id !== op.id) };
    }
  }
}

// ---- change lists ------------------------------------------------------------------------

const yuan = (fen: number) => `¥${fen % 100 === 0 ? fen / 100 : (fen / 100).toFixed(2)}`;
const json = (x: unknown) => JSON.stringify(x);
const quote = (s: Section) => {
  const title = "title" in s.props && typeof s.props.title === "string" && s.props.title ? `：${s.props.title}` : "";
  return `「${sectionLabel(s.type)}」${title}`;
};

const FONTS: Record<Theme["font"], string> = { system: "默认", rounded: "圆体", serif: "宋体" };
const RADII: Record<Theme["radius"], string> = { square: "直角", soft: "小圆角", round: "大圆角" };

// A rough colour name, so a change list can say 主色 粉→红.
export function colorName(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (s < 0.15 || l < 0.12 || l > 0.92) return l > 0.85 ? "白" : l < 0.2 ? "黑" : "灰";
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 350) return l > 0.7 ? "粉" : "红";
  if (h < 40) return l < 0.35 ? "棕" : "橙";
  if (h < 65) return "黄";
  if (h < 165) return "绿";
  if (h < 200) return "青";
  if (h < 255) return "蓝";
  if (h < 290) return "紫";
  return "粉";
}

const variantName = (p: ProductContent, v: VariantContent) => [p.name, ...Object.values(v.attributes)].join(" ");

function priceRange(p: ProductContent) {
  const prices = p.variants.map((v) => v.priceFen);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? yuan(low) : `${yuan(low)}–${yuan(high)}`;
}

function describeProduct(old: ProductContent, p: ProductContent): string[] {
  const out: string[] = [];
  if (old.name !== p.name) out.push(`${old.name} 改名为 ${p.name}`);
  p.variants.forEach((v, i) => {
    const before = old.variants.find((x) => x.id === v.id);
    if (!before) out.push(`${p.name} 新增规格 ${Object.values(v.attributes).join(" ") || "默认"} ${yuan(v.priceFen)}`);
    else if (before.priceFen !== v.priceFen) out.push(`${variantName(p, v)} ${yuan(before.priceFen)}→${yuan(v.priceFen)}`);
    else if (json(before.attributes) !== json(v.attributes)) out.push(`${p.name} 第 ${i + 1} 个规格改为 ${Object.values(v.attributes).join(" ")}`);
  });
  for (const v of old.variants) if (!p.variants.some((x) => x.id === v.id)) out.push(`${p.name} 删除规格 ${Object.values(v.attributes).join(" ") || "默认"}`);
  if (old.published !== p.published) out.push(p.published ? `${p.name} 上架` : `${p.name} 下架`);
  const fields: [keyof ProductContent, string][] = [
    ["description", "介绍"],
    ["images", "图片"],
    ["orderOptions", "下单选项"],
    ["info", "展示信息"],
    ["durationMinutes", "时长"],
    ["fulfillment", "交付方式"],
  ];
  const touched = fields.filter(([k]) => json(old[k]) !== json(p[k])).map(([, label]) => label);
  if (touched.length) out.push(`修改了 ${p.name} 的${touched.join("、")}`);
  return out;
}

function describeShop(old: ShopContent, patch: Partial<ShopContent>): string[] {
  const out: string[] = [];
  if (patch.name !== undefined && patch.name !== old.name) out.push(`店名 ${old.name}→${patch.name}`);
  if (patch.phone !== undefined && patch.phone !== old.phone) out.push(`电话 ${old.phone}→${patch.phone}`);
  if (patch.address !== undefined && patch.address !== old.address) out.push(patch.address ? `地址改为 ${patch.address}` : "删除了地址");
  if (patch.description !== undefined && patch.description !== old.description) out.push("修改了店铺介绍");
  if (patch.hours !== undefined && json(patch.hours) !== json(old.hours)) {
    if (!patch.hours) out.push("关闭预约");
    else if (!old.hours) out.push("开启预约");
    else {
      if (json(patch.hours.weekly) !== json(old.hours.weekly) || patch.hours.stepMinutes !== old.hours.stepMinutes) out.push("修改了营业时间");
      if (patch.hours.capacity !== old.hours.capacity) out.push(`同时接待 ${old.hours.capacity}→${patch.hours.capacity} 位`);
    }
  }
  if (patch.cancelPolicy && patch.cancelPolicy.freeCancelHoursBefore !== old.cancelPolicy.freeCancelHoursBefore) {
    out.push(`免费取消 提前 ${old.cancelPolicy.freeCancelHoursBefore}→${patch.cancelPolicy.freeCancelHoursBefore} 小时`);
  }
  return out;
}

// One line for the merchant's change list, e.g. "酸菜鱼 ¥38→¥42；修改了 酸菜鱼 的图片".
// Throws when the op changes nothing, so lists don't fill with no-ops.
export function describeOp(before: Content, op: Op): string {
  let parts: string[];
  switch (op.kind) {
    case "shop.update":
      parts = describeShop(before.shop, op.patch);
      break;
    case "theme.update": {
      const t = before.page.theme;
      const n = { ...t, ...op.patch };
      parts = [
        ...(n.style !== t.style ? [`模板 ${STYLES[t.style].label}→${STYLES[n.style].label}`] : []),
        ...(n.primary.toLowerCase() !== t.primary.toLowerCase()
          ? [colorName(n.primary) === colorName(t.primary) ? `主色 ${t.primary}→${n.primary}` : `主色 ${colorName(t.primary)}→${colorName(n.primary)}`]
          : []),
        ...(n.font !== t.font ? [`字体 ${FONTS[t.font]}→${FONTS[n.font]}`] : []),
        ...(n.radius !== t.radius ? [`圆角 ${RADII[t.radius]}→${RADII[n.radius]}`] : []),
      ];
      break;
    }
    case "section.add":
      parts = [`新增${quote(op.section)}`];
      break;
    case "section.update": {
      const old = findSection(before, op.id);
      const next = parseSectionInput({ ...old, props: { ...old.props, ...op.props } });
      const oldTitle = (old.props as { title?: unknown }).title;
      const newTitle = (next.props as { title?: unknown }).title;
      if (json(old.props) === json(next.props)) parts = [];
      else if (oldTitle !== newTitle && typeof newTitle === "string") parts = [`「${sectionLabel(old.type)}」标题 ${oldTitle || "（空）"}→${newTitle || "（空）"}`];
      else parts = [`修改${quote(old)}`];
      break;
    }
    case "section.move": {
      const at = before.page.sections.findIndex((s) => s.id === op.id);
      const s = findSection(before, op.id);
      const rest = before.page.sections.length - 1;
      parts = at === Math.min(op.index, rest) ? [] : [`把${quote(s)}移到第 ${Math.min(op.index, rest) + 1} 位`];
      break;
    }
    case "section.remove":
      parts = [`删除${quote(findSection(before, op.id))}`];
      break;
    case "product.create":
      parts = [`新增商品 ${op.product.name} ${priceRange(op.product)}`];
      break;
    case "product.update":
      parts = describeProduct(findProduct(before, op.product.id), op.product);
      break;
    case "product.delete":
      parts = [`删除商品 ${findProduct(before, op.id).name}`];
      break;
  }
  if (parts.length === 0) throw new ShopError(400, "no_change", "这次修改和现在的内容一样，没有需要保存的变化");
  return parts.join("；");
}
