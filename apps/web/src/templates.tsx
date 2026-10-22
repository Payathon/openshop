// Shop templates as defined in @openshop/core (STYLES in page.ts): they restyle the same page,
// so switching never loses content. Each comes with the font and corners it looks best in.
// Thumbnails in public/templates/ are screenshots of the demo shops (see docs/dev-notes.md).

import type { Theme } from "./studio.tsx";

export const TEMPLATES: { key: Theme["style"]; label: string; description: string; font: Theme["font"]; radius: Theme["radius"] }[] = [
  { key: "minimal", label: "简约", description: "黑白配色、大留白，什么店都合适", font: "system", radius: "square" },
  { key: "fashion", label: "服装", description: "满屏大图和竖版商品图，适合服装鞋包", font: "system", radius: "square" },
  { key: "dining", label: "餐厅", description: "菜单式价目表，营业时间放在显眼处", font: "serif", radius: "soft" },
  { key: "beauty", label: "美业", description: "柔和的色块和圆角卡片，适合美甲美发", font: "rounded", radius: "round" },
];

// The theme patch for switching to a template.
export function templatePatch(key: Theme["style"]): Partial<Theme> {
  const t = TEMPLATES.find((x) => x.key === key)!;
  return { style: t.key, font: t.font, radius: t.radius };
}

export function TemplatePicker(props: { value: Theme["style"] | null; onPick: (key: Theme["style"]) => void; selectedText?: string; disabled?: boolean }) {
  return (
    <div className="templates" role="radiogroup" aria-label="模板">
      {TEMPLATES.map((t) => (
        <button
          key={t.key}
          type="button"
          role="radio"
          aria-checked={props.value === t.key}
          className={props.value === t.key ? "template selected" : "template"}
          disabled={props.disabled}
          onClick={() => props.value !== t.key && props.onPick(t.key)}
        >
          <img src={`/admin/templates/${t.key}.jpg`} alt="" width={390} height={520} loading="lazy" />
          <strong>
            {t.label}
            {props.value === t.key && <span className="subtle">{props.selectedText ?? "使用中"}</span>}
          </strong>
          <span className="subtle">{t.description}</span>
        </button>
      ))}
    </div>
  );
}
