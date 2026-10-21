import { useEffect, useRef, useState } from "react";
import { message, request } from "../api.ts";
import { useStudio, type Product, type Section, type Theme } from "../studio.tsx";
import { Badge, Card, Empty, Field, Page, useToast } from "../ui.tsx";

// Section types as defined in @openshop/core (page.ts). Labels match the server's change list.
const LABELS: Record<string, string> = {
  header: "店铺信息",
  banner: "推广横幅",
  products: "商品展示",
  booking: "营业时间",
  gallery: "相册",
  text: "图文介绍",
  contact: "联系方式",
  custom_html: "自定义内容",
};
const SINGLE = new Set(["header", "booking", "contact"]);
const ADDABLE: { type: string; props: Record<string, unknown>; help: string }[] = [
  { type: "banner", props: { title: "新活动" }, help: "首页醒目的活动推广" },
  { type: "products", props: {}, help: "再放一组商品，比如只放快递商品" },
  { type: "gallery", props: {}, help: "作品照片、店内环境" },
  { type: "text", props: { title: "关于我们" }, help: "一段文字，可配一张图" },
  { type: "booking", props: {}, help: "营业时间和预约须知" },
  { type: "custom_html", props: { html: "<p>在这里写点什么</p>" }, help: "自由排版的文字和图片" },
];

const COLORS = ["#d6336c", "#e8590c", "#f59f00", "#2f9e44", "#1a7f5a", "#1c7ed6", "#5f3dc4", "#212529"];

function ThemeCard(props: { theme: Theme }) {
  const { propose } = useStudio();
  const set = (patch: Partial<Theme>) => void propose({ kind: "theme.update", patch }, { quiet: true });
  return (
    <Card title="风格">
      <Field label="主色">
        <div className="swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              className={props.theme.primary.toLowerCase() === c ? "swatch selected" : "swatch"}
              style={{ background: c }}
              aria-label={`主色 ${c}`}
              onClick={() => props.theme.primary.toLowerCase() !== c && set({ primary: c })}
            />
          ))}
          <label className={COLORS.includes(props.theme.primary.toLowerCase()) ? "swatch custom" : "swatch custom selected"} title="自定义颜色">
            <input type="color" value={props.theme.primary} onChange={(e) => set({ primary: e.target.value })} />
          </label>
        </div>
      </Field>
      <div className="grid-2">
        <Field label="字体">
          <select className="select" value={props.theme.font} onChange={(e) => set({ font: e.target.value as Theme["font"] })}>
            <option value="system">默认</option>
            <option value="rounded">圆体</option>
            <option value="serif">宋体</option>
          </select>
        </Field>
        <Field label="圆角">
          <select className="select" value={props.theme.radius} onChange={(e) => set({ radius: e.target.value as Theme["radius"] })}>
            <option value="square">直角</option>
            <option value="soft">小圆角</option>
            <option value="round">大圆角</option>
          </select>
        </Field>
      </div>
    </Card>
  );
}

async function uploadImage(file: File) {
  return (await request<{ url: string }>("POST", "/api/merchant/uploads", file)).url;
}

function ImagePicker(props: { value: string | null; onChange: (url: string | null) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="row">
      {props.value && <span className="thumb" style={{ backgroundImage: `url("${props.value}")` }} />}
      <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "上传中…" : props.value ? "换一张" : "上传图片"}
      </button>
      {props.value && (
        <button type="button" className="btn plain critical" onClick={() => props.onChange(null)}>
          移除
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            props.onChange(await uploadImage(f));
          } catch (err) {
            toast(message(err), { critical: true });
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}

// The props form for one section. Edits are kept locally and saved together.
function SectionForm(props: { section: Section; products: Product[]; onSave: (p: Record<string, unknown>) => Promise<void> }) {
  const [p, setP] = useState(props.section.props);
  const [busy, setBusy] = useState(false);
  useEffect(() => setP(props.section.props), [props.section.props]);
  const set = (patch: Record<string, unknown>) => setP((x) => ({ ...x, ...patch }));
  const text = (key: string, label: string, opts: { max?: number; area?: boolean; help?: string } = {}) => (
    <Field label={label} help={opts.help}>
      {opts.area ? (
        <textarea className="textarea" maxLength={opts.max} value={String(p[key] ?? "")} onChange={(e) => set({ [key]: e.target.value })} />
      ) : (
        <input className="input" maxLength={opts.max} value={String(p[key] ?? "")} onChange={(e) => set({ [key]: e.target.value })} />
      )}
    </Field>
  );
  const changed = JSON.stringify(p) !== JSON.stringify(props.section.props);
  const t = props.section.type;

  return (
    <div className="stack section-form">
      {t === "header" && (
        <label className="check">
          <input type="checkbox" checked={p.showDescription !== false} onChange={(e) => set({ showDescription: e.target.checked })} />
          显示店铺介绍（在“设置”里修改店名和介绍）
        </label>
      )}
      {t === "banner" && (
        <>
          {text("title", "标题", { max: 40 })}
          {text("subtitle", "副标题", { max: 80 })}
          <Field label="背景图（选填）">
            <ImagePicker value={(p.image as string | null) ?? null} onChange={(image) => set({ image })} />
          </Field>
          <Field label="点击后打开">
            <select className="select" value={(p.productId as string | null) ?? ""} onChange={(e) => set({ productId: e.target.value || null })}>
              <option value="">不跳转</option>
              {props.products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {t === "products" && (
        <>
          {text("title", "标题", { max: 20 })}
          <div className="grid-2">
            <Field label="显示哪些">
              <select className="select" value={String(p.fulfillment ?? "all")} onChange={(e) => set({ fulfillment: e.target.value })}>
                <option value="all">全部商品</option>
                <option value="booking">只显示预约服务</option>
                <option value="shipping">只显示快递商品</option>
              </select>
            </Field>
            <Field label="排列方式">
              <select className="select" value={String(p.layout ?? "list")} onChange={(e) => set({ layout: e.target.value })}>
                <option value="list">列表</option>
                <option value="grid">两列网格</option>
              </select>
            </Field>
          </div>
        </>
      )}
      {t === "booking" && (
        <>
          {text("title", "标题", { max: 20 })}
          {text("note", "预约须知（选填）", { max: 300, area: true, help: "比如：请提前 10 分钟到店，迟到 15 分钟视为取消" })}
        </>
      )}
      {t === "gallery" && (
        <>
          {text("title", "标题", { max: 20 })}
          <div className="images">
            {((p.images as { src: string; caption: string }[]) ?? []).map((img, i) => (
              <div key={img.src + i} className="image">
                <img src={img.src} alt="" />
                <button
                  type="button"
                  className="image-remove"
                  aria-label="删除图片"
                  onClick={() => set({ images: (p.images as unknown[]).filter((_, n) => n !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            <GalleryAdd onAdd={(src) => set({ images: [...((p.images as unknown[]) ?? []), { src, caption: "" }] })} />
          </div>
        </>
      )}
      {t === "text" && (
        <>
          {text("title", "标题", { max: 30 })}
          {text("body", "正文", { max: 2000, area: true })}
          <Field label="配图（选填）">
            <ImagePicker value={(p.image as string | null) ?? null} onChange={(image) => set({ image })} />
          </Field>
        </>
      )}
      {t === "contact" && text("title", "标题", { max: 20 })}
      {t === "custom_html" && text("html", "内容（支持简单的 HTML，不能放脚本）", { max: 20000, area: true })}
      {t !== "header" || changed ? (
        <div>
          <button
            className="btn primary"
            disabled={!changed || busy}
            onClick={async () => {
              setBusy(true);
              await props.onSave(p);
              setBusy(false);
            }}
          >
            保存这个区块
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GalleryAdd(props: { onAdd: (src: string) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className="image add" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "上传中…" : "+ 添加照片"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          setBusy(true);
          try {
            for (const f of Array.from(e.target.files ?? [])) props.onAdd(await uploadImage(f));
          } catch (err) {
            toast(message(err), { critical: true });
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }}
      />
    </>
  );
}

function SectionsCard(props: { sections: Section[]; products: Product[] }) {
  const { propose } = useStudio();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const present = new Set(props.sections.map((s) => s.type));
  const addable = ADDABLE.filter((a) => !(SINGLE.has(a.type) && present.has(a.type)));
  const last = props.sections.length - 1;

  return (
    <Card flush title="页面区块" action={<span className="subtle">从上到下就是顾客看到的顺序</span>}>
      <div className="list">
        {props.sections.map((s, i) => (
          <div key={s.id} className={open === s.id ? "section-item open" : "section-item"}>
            <div className="section-head">
              <button className="section-title" onClick={() => setOpen(open === s.id ? null : s.id)}>
                <span className="caret" aria-hidden>
                  {open === s.id ? "▾" : "▸"}
                </span>
                <strong>{LABELS[s.type] ?? s.type}</strong>
                {typeof s.props.title === "string" && s.props.title && s.type !== "contact" && <span className="subtle">{s.props.title}</span>}
              </button>
              {s.type !== "header" && (
                <div className="row" style={{ gap: 2 }}>
                  <button className="btn plain" aria-label="上移" disabled={i <= 1} onClick={() => void propose({ kind: "section.move", id: s.id, index: i - 1 }, { quiet: true })}>
                    ↑
                  </button>
                  <button className="btn plain" aria-label="下移" disabled={i >= last} onClick={() => void propose({ kind: "section.move", id: s.id, index: i + 1 }, { quiet: true })}>
                    ↓
                  </button>
                  <button
                    className="btn plain critical"
                    aria-label="删除"
                    onClick={() => confirm(`删除“${LABELS[s.type]}”区块？`) && void propose({ kind: "section.remove", id: s.id }, { quiet: true })}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
            {open === s.id && (
              <SectionForm section={s} products={props.products} onSave={async (p) => void (await propose({ kind: "section.update", id: s.id, props: p }))} />
            )}
          </div>
        ))}
      </div>
      <div className="card-header">
        {adding ? (
          <div className="stack" style={{ width: "100%" }}>
            <div className="tiles">
              {addable.map((a) => (
                <button
                  key={a.type}
                  className="tile"
                  onClick={async () => {
                    setAdding(false);
                    await propose({ kind: "section.add", section: { type: a.type, props: a.props } }, { quiet: true });
                  }}
                >
                  <strong>{LABELS[a.type]}</strong>
                  <span className="subtle">{a.help}</span>
                </button>
              ))}
            </div>
            <div>
              <button className="btn plain" onClick={() => setAdding(false)}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <button className="btn" onClick={() => setAdding(true)}>
            + 添加区块
          </button>
        )}
      </div>
    </Card>
  );
}

function PhonePreview(props: { url: string }) {
  const { revision } = useStudio();
  const frame = useRef<HTMLIFrameElement>(null);
  // Reload in place after each edit, keeping the scroll position where possible.
  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    let y = 0;
    try {
      y = f.contentWindow?.scrollY ?? 0;
    } catch {
      // Cross-origin in dev: start from the top.
    }
    const onLoad = () => {
      try {
        f.contentWindow?.scrollTo(0, y);
      } catch {
        // Cross-origin in dev.
      }
    };
    f.addEventListener("load", onLoad, { once: true });
    f.src = props.url;
  }, [revision, props.url]);

  return (
    <div className="phone-wrap only-wide">
      <div className="phone">
        <iframe ref={frame} title="店铺预览" />
      </div>
      <a className="subtle" href={props.url} target="_blank" rel="noreferrer">
        在新窗口打开预览 ↗
      </a>
    </div>
  );
}

export function Design() {
  const { overview } = useStudio();
  if (!overview) return <Page title="店铺装修"><Empty>加载中…</Empty></Page>;
  return (
    <Page
      title="店铺装修"
      badge={<Badge>改动发布后生效</Badge>}
      actions={
        <a className="btn only-narrow" href={overview.previewUrl} target="_blank" rel="noreferrer">
          预览店铺
        </a>
      }
    >
      <div className="design">
        <div className="col">
          <ThemeCard theme={overview.page.theme} />
          <SectionsCard sections={overview.page.sections} products={overview.products} />
        </div>
        <PhonePreview url={overview.previewUrl} />
      </div>
    </Page>
  );
}
