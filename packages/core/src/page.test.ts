import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defaultPage, migrateSection, PageConfigError, parsePage, parseSection, sanitizeCustomHtml } from "./page.ts";
import { MODULE_KEYS, TEMPLATES, templatePage, templateSamples } from "./templates.ts";
import { productInputSchema } from "./catalog.ts";

describe("sections", () => {
  it("fills defaults and stamps the current version", () => {
    expect(parseSection({ id: "b1", type: "banner", props: { title: "周末 8 折" } })).toEqual({
      id: "b1",
      type: "banner",
      v: 1,
      props: { title: "周末 8 折", subtitle: "", image: null, productId: null },
    });
  });

  it("rejects unknown types, bad props and unsafe images", () => {
    expect(() => parseSection({ id: "x", type: "carousel" })).toThrow("未知的区块类型");
    expect(() => parseSection({ id: "b1", type: "banner", props: {} })).toThrow("推广横幅");
    expect(() => parseSection({ id: "g", type: "gallery", props: { images: [{ src: "javascript:alert(1)" }] } })).toThrow(PageConfigError);
    expect(() => parseSection({ id: "Bad Id", type: "header" })).toThrow("区块 id");
  });

  it("migrates props saved under older versions step by step", () => {
    const defs = {
      banner: {
        label: "横幅",
        version: 3,
        props: z.object({}),
        migrations: {
          1: (p: Record<string, unknown>) => ({ title: p.text }),
          2: (p: Record<string, unknown>) => ({ ...p, subtitle: "" }),
        },
      },
    };
    expect(migrateSection({ id: "b", type: "banner", v: 1, props: { text: "旧标题" } }, defs)).toEqual({
      id: "b",
      type: "banner",
      v: 3,
      props: { title: "旧标题", subtitle: "" },
    });
    expect(() => migrateSection({ id: "b", type: "banner", v: 4 }, defs)).toThrow("比当前版本");
  });
});

describe("pages", () => {
  it("needs the shop header exactly once and unique ids", () => {
    expect(() => parsePage({ sections: [{ id: "c", type: "contact" }] })).toThrow("店铺信息");
    expect(() => parsePage({ sections: [{ id: "h", type: "header" }, { id: "h", type: "contact" }] })).toThrow("重复");
    expect(() =>
      parsePage({ sections: [{ id: "h", type: "header" }, { id: "c1", type: "contact" }, { id: "c2", type: "contact" }] }),
    ).toThrow("只能有一个");
  });

  it("validates the theme", () => {
    expect(parsePage({ sections: [{ id: "h", type: "header" }] }).theme).toEqual({ style: "minimal", primary: "#d6336c", font: "system", radius: "soft" });
    expect(() => parsePage({ sections: [{ id: "h", type: "header" }], theme: { primary: "pink" } })).toThrow("#RRGGBB");
    expect(() => parsePage({ sections: [{ id: "h", type: "header" }], theme: { style: "brutalist" } })).toThrow();
  });

  it("gives each industry a template, and lets onboarding pick another", () => {
    expect(templatePage(TEMPLATES.restaurant!, ["booking"]).theme).toMatchObject({ style: "dining", font: "serif" });
    expect(templatePage(TEMPLATES.fashion!, ["shopping"]).sections.find((s) => s.type === "products")?.props).toMatchObject({ layout: "grid" });
    // A different template brings its own font and corners but keeps the industry's colour.
    expect(templatePage(TEMPLATES.nail!, ["booking"], "minimal").theme).toEqual({ style: "minimal", primary: "#d6336c", font: "system", radius: "square" });
  });

  it("defaults to the M2 layout", () => {
    expect(defaultPage({ booking: true }).sections.map((s) => s.type)).toEqual(["header", "products", "booking", "contact"]);
    expect(defaultPage({ booking: false }).sections.map((s) => s.type)).toEqual(["header", "products", "contact"]);
  });
});

describe("custom HTML", () => {
  it("keeps formatting and drops scripts, handlers, iframes and styles", () => {
    const clean = sanitizeCustomHtml(
      `<h2 onclick="x()">品牌故事</h2><script>alert(1)</script><iframe src="https://evil"></iframe>` +
        `<p style="position:fixed">文字<a href="javascript:alert(1)">坏链接</a><a href="https://ok.example">好链接</a></p>` +
        `<img src="data:image/png;base64,xx"><img src="https://img.example/a.jpg" onerror="x()">`,
    );
    expect(clean).toContain("<h2>品牌故事</h2>");
    expect(clean).not.toMatch(/script|iframe|onclick|onerror|style=|javascript:|data:/);
    expect(clean).toContain('<a href="https://ok.example" target="_blank" rel="noopener noreferrer nofollow">好链接</a>');
    expect(clean).toContain('<img src="https://img.example/a.jpg" loading="lazy" />');
  });

  it("sanitizes when the section is parsed", () => {
    const s = parseSection({ id: "c", type: "custom_html", props: { html: "<p>hi</p><script>x</script>" } });
    expect(s.props).toEqual({ html: "<p>hi</p>" });
  });
});

describe("industry templates", () => {
  it.each(Object.keys(TEMPLATES))("%s builds a valid page and valid sample products", (key) => {
    const t = TEMPLATES[key]!;
    const page = templatePage(t, t.modules);
    expect(page.sections[0]!.type).toBe("header");
    expect(page.sections.at(-1)!.type).toBe("contact");
    const samples = templateSamples(t, t.modules);
    expect(samples.length).toBeGreaterThan(0);
    for (const p of samples) expect(productInputSchema.parse(p)).toEqual(p);
  });

  it("follows the chosen modules", () => {
    const t = TEMPLATES.generic!;
    const page = templatePage(t, ["shopping"]);
    expect(page.sections.map((s) => s.type)).toEqual(["header", "products", "contact"]);
    expect(templateSamples(t, ["shopping"]).every((p) => p.fulfillment === "shipping")).toBe(true);
    expect(templatePage(t, MODULE_KEYS).sections.map((s) => s.type)).toEqual(["header", "banner", "products", "booking", "text", "gallery", "contact"]);
  });
});
