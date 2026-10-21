import sanitizeHtml from "sanitize-html";
import { z } from "zod";

// A shop's page is a list of sections plus a theme (docs/tech-plan.md, 页面配置示例).
// Every section type is defined once here: its props schema, its schema version, and how to
// migrate props saved under older versions. The web renderer, the merchant API and the
// merchant agent's tools all validate through parsePage / parseSection.

export class PageConfigError extends Error {}

const MAX_SECTIONS = 30;

// https links, or paths on our own server (uploads). No data: or javascript: URLs.
export const imageUrl = z
  .string()
  .max(2000)
  .regex(/^(https?:\/\/|\/)/, "图片地址必须是 http(s) 链接或站内路径");

// Custom HTML is merchant (or agent) written. Allowlist only: no scripts, no event handlers,
// no iframes, forms or styles; links open in a new tab without referrer access.
export function sanitizeCustomHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "strong", "b", "em", "i", "u", "s", "small", "span", "div",
      "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "hr",
      "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tr", "th", "td",
    ],
    // target, rel and loading are always overwritten by transformTags below.
    allowedAttributes: { a: ["href", "title", "target", "rel"], img: ["src", "alt", "width", "height", "loading"], "*": ["class"] },
    allowedSchemes: ["http", "https", "tel", "mailto"],
    allowedSchemesByTag: { img: ["http", "https"] },
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }),
    },
  });
}

interface SectionDef<P extends z.ZodType> {
  // Shown to merchants, e.g. in change lists: 新增「推广横幅」.
  label: string;
  version: number;
  props: P;
  // migrations[n] turns version-n props into version n+1.
  migrations?: Record<number, (props: Record<string, unknown>) => Record<string, unknown>>;
  // At most one per page.
  single?: boolean;
  // Must be on every page (店铺信息 is the one required module, product-decisions #5).
  required?: boolean;
}

const def = <P extends z.ZodType>(d: SectionDef<P>) => d;

export const SECTIONS = {
  header: def({
    label: "店铺信息",
    version: 1,
    single: true,
    required: true,
    props: z.object({ showDescription: z.boolean().default(true) }),
  }),
  banner: def({
    label: "推广横幅",
    version: 1,
    props: z.object({
      title: z.string().min(1).max(40),
      subtitle: z.string().max(80).default(""),
      image: imageUrl.nullable().default(null),
      // Taps go to this product's page; null for a banner without a link.
      productId: z.string().nullable().default(null),
    }),
  }),
  products: def({
    label: "商品展示",
    version: 1,
    props: z.object({
      title: z.string().max(20).default("商品与服务"),
      fulfillment: z.enum(["all", "booking", "shipping"]).default("all"),
      // "all", or chosen products in this order.
      productIds: z.union([z.literal("all"), z.array(z.string()).max(100)]).default("all"),
      layout: z.enum(["list", "grid"]).default("list"),
    }),
  }),
  booking: def({
    label: "营业时间",
    version: 1,
    single: true,
    props: z.object({ title: z.string().max(20).default("营业时间"), note: z.string().max(300).default("") }),
  }),
  gallery: def({
    label: "相册",
    version: 1,
    props: z.object({
      title: z.string().max(20).default("相册"),
      images: z.array(z.object({ src: imageUrl, caption: z.string().max(40).default("") })).max(24).default([]),
    }),
  }),
  text: def({
    label: "图文介绍",
    version: 1,
    props: z.object({
      title: z.string().max(30).default(""),
      body: z.string().max(2000).default(""),
      image: imageUrl.nullable().default(null),
    }),
  }),
  contact: def({
    label: "联系方式",
    version: 1,
    single: true,
    props: z.object({ title: z.string().max(20).default("联系店铺") }),
  }),
  custom_html: def({
    label: "自定义内容",
    version: 1,
    props: z.object({ html: z.string().max(20_000).transform(sanitizeCustomHtml) }),
  }),
};

export type SectionType = keyof typeof SECTIONS;
export const SECTION_TYPES = Object.keys(SECTIONS) as SectionType[];

type PropsOf<T extends SectionType> = z.infer<(typeof SECTIONS)[T]["props"]>;
export type Section = { [T in SectionType]: { id: string; type: T; v: number; props: PropsOf<T> } }[SectionType];
export type SectionOf<T extends SectionType> = Extract<Section, { type: T }>;

export const sectionLabel = (type: SectionType) => SECTIONS[type].label;

export const themeSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/, "主色必须是 #RRGGBB 格式").default("#d6336c"),
  font: z.enum(["system", "rounded", "serif"]).default("system"),
  radius: z.enum(["square", "soft", "round"]).default("soft"),
});
export type Theme = z.infer<typeof themeSchema>;

export interface PageConfig {
  sections: Section[];
  theme: Theme;
}

const sectionId = z.string().regex(/^[a-z0-9_-]{1,40}$/, "区块 id 只能用小写字母、数字、下划线和连字符");

const rawSection = z.object({
  id: sectionId,
  type: z.string(),
  v: z.number().int().positive().optional(),
  props: z.record(z.string(), z.unknown()).default({}),
});

// Brings props saved under an older version up to the current one. Missing v means current.
export function migrateSection(raw: unknown, defs: Record<string, SectionDef<z.ZodType>> = SECTIONS) {
  const r = rawSection.safeParse(raw);
  if (!r.success) throw new PageConfigError(z.prettifyError(r.error));
  const d = defs[r.data.type];
  if (!d) throw new PageConfigError(`未知的区块类型：${r.data.type}`);
  let { v = d.version, props } = r.data;
  if (v > d.version) throw new PageConfigError(`区块 ${r.data.id} 的版本 ${v} 比当前版本 ${d.version} 新`);
  for (; v < d.version; v++) {
    const step = d.migrations?.[v];
    if (!step) throw new PageConfigError(`缺少 ${r.data.type} 从版本 ${v} 升级的迁移`);
    props = step(props);
  }
  return { id: r.data.id, type: r.data.type, v, props };
}

export function parseSection(raw: unknown): Section {
  const m = migrateSection(raw);
  const props = SECTIONS[m.type as SectionType].props.safeParse(m.props);
  if (!props.success) throw new PageConfigError(`「${sectionLabel(m.type as SectionType)}」${z.prettifyError(props.error)}`);
  return { ...m, props: props.data } as Section;
}

export function parseTheme(raw: unknown): Theme {
  const r = themeSchema.safeParse(raw ?? {});
  if (!r.success) throw new PageConfigError(z.prettifyError(r.error));
  return r.data;
}

export function parsePage(raw: { sections: unknown; theme?: unknown }): PageConfig {
  if (!Array.isArray(raw.sections)) throw new PageConfigError("sections 必须是数组");
  if (raw.sections.length > MAX_SECTIONS) throw new PageConfigError(`一个页面最多 ${MAX_SECTIONS} 个区块`);
  const sections = raw.sections.map(parseSection);
  checkSections(sections);
  return { sections, theme: parseTheme(raw.theme) };
}

// Page-level rules: unique ids, required sections present, single sections at most once.
export function checkSections(sections: Section[]) {
  const ids = new Set<string>();
  for (const s of sections) {
    if (ids.has(s.id)) throw new PageConfigError(`区块 id 重复：${s.id}`);
    ids.add(s.id);
  }
  for (const type of SECTION_TYPES) {
    const n = sections.filter((s) => s.type === type).length;
    const d: SectionDef<z.ZodType> = SECTIONS[type];
    if (d.required && n === 0) throw new PageConfigError(`页面必须有「${d.label}」`);
    if (d.single && n > 1) throw new PageConfigError(`「${d.label}」只能有一个`);
  }
  if (sections.length > MAX_SECTIONS) throw new PageConfigError(`一个页面最多 ${MAX_SECTIONS} 个区块`);
}

// The page a shop has before anyone configures it; matches the M2 storefront layout.
export function defaultPage(opts: { booking: boolean }): PageConfig {
  return parsePage({
    sections: [
      { id: "header", type: "header" },
      { id: "products", type: "products" },
      ...(opts.booking ? [{ id: "booking", type: "booking" }] : []),
      { id: "contact", type: "contact" },
    ],
  });
}
