import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { message, request } from "../api.ts";
import { useStudio, type OrderOption, type Product, type ProductInput } from "../studio.tsx";
import { Badge, Banner, Card, Empty, Field, Page, parseYuan, useToast, yuan } from "../ui.tsx";

const priceText = (p: Product) => {
  const prices = p.variants.map((v) => v.priceFen);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? yuan(lo) : `${yuan(lo)} 起`;
};

export function Products() {
  const { overview, propose } = useStudio();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function removeSamples() {
    const samples = overview?.products.filter((p) => p.sample && p.published) ?? [];
    if (!confirm(`删除这 ${samples.length} 个示例商品？`)) return;
    setBusy(true);
    for (const p of samples) if (!(await propose({ kind: "product.delete", id: p.id }, { quiet: true }))) break;
    setBusy(false);
    toast("示例商品已删除");
  }

  if (!overview) return <Page title="商品"><Empty>加载中…</Empty></Page>;
  const products = overview.products;
  const samples = products.filter((p) => p.sample && p.published);

  return (
    <Page
      title="商品"
      actions={
        <Link className="btn primary" to="/products/new">
          添加商品
        </Link>
      }
    >
      {samples.length > 0 && (
        <Banner
          tone="warning"
          title={`有 ${samples.length} 个示例商品`}
          action={
            <button className="btn" disabled={busy} onClick={() => void removeSamples()}>
              全部删除
            </button>
          }
        >
          <p>示例商品是帮你看效果的，发布前要改成你自己的商品（改过名字或价格就算），或者删掉。</p>
        </Banner>
      )}
      <Card flush>
        {products.length === 0 ? (
          <Empty>
            还没有商品。<Link to="/products/new">添加第一个</Link>
          </Empty>
        ) : (
          <div className="list">
            {products.map((p) => (
              <button key={p.id} className="list-row" onClick={() => navigate(`/products/${p.id}`)}>
                <span className="thumb" style={p.images[0] ? { backgroundImage: `url("${p.images[0]}")` } : undefined} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row">
                    <strong>{p.name}</strong>
                    {p.sample && <Badge tone="warning">示例</Badge>}
                    {!p.published && <Badge>已下架</Badge>}
                  </div>
                  <div className="subtle">
                    {p.fulfillment === "booking" ? `预约 · ${p.durationMinutes} 分钟` : "快递"}
                    {p.variants.length > 1 ? ` · ${p.variants.length} 个规格` : ""}
                    {p.fulfillment === "shipping" ? ` · 库存 ${p.variants.reduce((s, v) => s + (v.stock ?? 0), 0)}` : ""}
                  </div>
                </div>
                <span className="num">{priceText(p)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
    </Page>
  );
}

// ---- editing ----------------------------------------------------------------

interface VariantRow {
  id: string | null;
  value: string;
  price: string;
  stock: string;
}
interface OptionRow {
  key: string;
  label: string;
  type: "choice" | "text";
  choices: string;
  required: boolean;
}

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240];
const fenToInput = (fen: number) => (fen / 100).toFixed(2).replace(/\.00$/, "");

export function ProductEdit() {
  const { id } = useParams();
  const { overview, propose } = useStudio();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = id ? overview?.products.find((p) => p.id === id) : undefined;
  const hasBooking = overview?.shop.hours != null;

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [fulfillment, setFulfillment] = useState<"booking" | "shipping">("booking");
  const [duration, setDuration] = useState(60);
  const [dimension, setDimension] = useState("");
  const [variants, setVariants] = useState<VariantRow[]>([{ id: null, value: "", price: "", stock: "" }]);
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [info, setInfo] = useState<{ label: string; value: string }[]>([]);
  const [published, setPublished] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Fill the form once the product (or, for a new one, the shop) has loaded.
  useEffect(() => {
    if (loaded || !overview) return;
    if (id && !existing) return;
    if (existing) {
      setName(existing.name);
      setDescription(existing.description);
      setImages(existing.images);
      setFulfillment(existing.fulfillment);
      setDuration(existing.durationMinutes ?? 60);
      const dim = Object.keys(existing.variants[0]?.attributes ?? {})[0] ?? "";
      setDimension(dim);
      setVariants(
        existing.variants.map((v) => ({ id: v.id, value: dim ? (v.attributes[dim] ?? "") : "", price: fenToInput(v.priceFen), stock: v.stock === null ? "" : String(v.stock) })),
      );
      setOptions(
        existing.orderOptions.map((o) => ({ key: o.key, label: o.label, type: o.type, choices: o.type === "choice" ? o.choices.join("、") : "", required: o.required })),
      );
      setInfo(existing.info);
      setPublished(existing.published);
    } else {
      setFulfillment(hasBooking ? "booking" : "shipping");
      setVariants([{ id: null, value: "", price: "", stock: hasBooking ? "" : "10" }]);
    }
    setLoaded(true);
  }, [loaded, overview, id, existing, hasBooking]);

  if (!overview) return <Page title="商品" back="/products"><Empty>加载中…</Empty></Page>;
  if (id && !existing) return <Page title="商品" back="/products"><Banner tone="critical">找不到这个商品，可能已经删除了</Banner></Page>;

  const multi = dimension.trim() !== "" || variants.length > 1;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files).slice(0, 9 - images.length)) {
        const r = await request<{ url: string }>("POST", "/api/merchant/uploads", f);
        setImages((imgs) => [...imgs, r.url]);
      }
    } catch (e) {
      toast(message(e), { critical: true });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function build(): ProductInput | string {
    if (!name.trim()) return "请填写商品名称";
    const vs: ProductInput["variants"] = [];
    for (const [i, v] of variants.entries()) {
      const priceFen = parseYuan(v.price);
      if (priceFen === null) return `第 ${i + 1} 个${multi ? "规格" : ""}的价格不对，填数字，比如 168 或 9.9`;
      if (multi && !v.value.trim()) return `第 ${i + 1} 个规格还没有名称`;
      const stock = fulfillment === "shipping" ? Number(v.stock || 0) : null;
      if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return "库存要填 0 或正整数";
      vs.push({ attributes: multi ? { [dimension.trim() || "规格"]: v.value.trim() } : {}, priceFen, stock });
    }
    const oo: OrderOption[] = [];
    for (const [i, o] of options.entries()) {
      if (!o.label.trim()) return `第 ${i + 1} 个下单问题还没有写问什么`;
      if (o.type === "choice") {
        const choices = o.choices.split(/[、,，\n]/).map((c) => c.trim()).filter(Boolean);
        if (choices.length === 0) return `“${o.label}”至少要有一个选项`;
        oo.push({ key: o.key, label: o.label.trim(), type: "choice", choices, required: o.required });
      } else oo.push({ key: o.key, label: o.label.trim(), type: "text", required: o.required });
    }
    return {
      name: name.trim(),
      description: description.trim(),
      images,
      fulfillment,
      durationMinutes: fulfillment === "booking" ? duration : null,
      orderOptions: oo,
      info: info.filter((x) => x.label.trim() && x.value.trim()).map((x) => ({ label: x.label.trim(), value: x.value.trim() })),
      published,
      variants: vs,
    };
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const product = build();
    if (typeof product === "string") return setError(product);
    setError(null);
    setBusy(true);
    const ok = await propose(existing ? { kind: "product.update", id: existing.id, product } : { kind: "product.create", product });
    setBusy(false);
    if (ok) navigate("/products");
  }

  async function remove() {
    if (!existing || !confirm(`删除“${existing.name}”？发布后顾客就看不到了。`)) return;
    if (await propose({ kind: "product.delete", id: existing.id })) navigate("/products");
  }

  const setVariant = (i: number, patch: Partial<VariantRow>) => setVariants((vs) => vs.map((v, n) => (n === i ? { ...v, ...patch } : v)));
  const setOption = (i: number, patch: Partial<OptionRow>) => setOptions((os) => os.map((o, n) => (n === i ? { ...o, ...patch } : o)));

  return (
    <form onSubmit={save}>
      <Page
        title={existing ? existing.name : "添加商品"}
        back="/products"
        badge={existing?.sample ? <Badge tone="warning">示例</Badge> : undefined}
        actions={
          <button className="btn primary" disabled={busy || uploading}>
            {busy ? "保存中…" : "保存"}
          </button>
        }
      >
        {error && <Banner tone="critical">{error}</Banner>}
        {existing?.sample && <Banner tone="warning">这是示例商品。改成你自己的名称和价格后保存，就会变成正式商品。</Banner>}
        <div className="layout">
          <div className="col">
            <Card>
              <Field label="名称">
                <input className="input" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：法式美甲" />
              </Field>
              <Field label="介绍（选填）">
                <textarea className="textarea" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="顾客能在商品页看到" />
              </Field>
            </Card>

            <Card title="图片" action={<span className="subtle">{images.length} / 9</span>}>
              <div className="images">
                {images.map((src, i) => (
                  <div key={src} className="image">
                    <img src={src} alt="" />
                    <button type="button" className="image-remove" aria-label="删除图片" onClick={() => setImages((imgs) => imgs.filter((_, n) => n !== i))}>
                      ×
                    </button>
                    {i === 0 && <span className="image-cover">封面</span>}
                  </div>
                ))}
                {images.length < 9 && (
                  <button type="button" className="image add" onClick={() => fileInput.current?.click()} disabled={uploading}>
                    {uploading ? "上传中…" : "+ 添加图片"}
                  </button>
                )}
              </div>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={(e) => void upload(e.target.files)} />
              <p className="subtle">JPG、PNG、WebP，每张不超过 5 MB。第一张是封面。</p>
            </Card>

            <Card title="价格">
              {!multi ? (
                <div className="grid-2">
                  <Field label="价格">
                    <div className="input-group">
                      <span className="prefix">¥</span>
                      <input className="input" inputMode="decimal" required value={variants[0]!.price} onChange={(e) => setVariant(0, { price: e.target.value })} placeholder="0" />
                    </div>
                  </Field>
                  {fulfillment === "shipping" && (
                    <Field label="库存" help={variants[0]!.id ? "已有商品的库存在“营业时间与库存”里改，立即生效" : undefined}>
                      <input className="input" inputMode="numeric" disabled={variants[0]!.id !== null} value={variants[0]!.stock} onChange={(e) => setVariant(0, { stock: e.target.value.replace(/\D/g, "") })} />
                    </Field>
                  )}
                </div>
              ) : (
                <div className="stack">
                  <Field label="规格名称" help="比如：尺寸、套餐、人数">
                    <input className="input" value={dimension} onChange={(e) => setDimension(e.target.value)} placeholder="规格" />
                  </Field>
                  {variants.map((v, i) => (
                    <div key={i} className="variant-row">
                      <input className="input" value={v.value} onChange={(e) => setVariant(i, { value: e.target.value })} placeholder={`选项 ${i + 1}，比如：大盒`} />
                      <div className="input-group">
                        <span className="prefix">¥</span>
                        <input className="input" inputMode="decimal" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })} placeholder="价格" />
                      </div>
                      {fulfillment === "shipping" && (
                        <input className="input" inputMode="numeric" disabled={v.id !== null} title={v.id ? "已有规格的库存在“营业时间与库存”里改" : ""} value={v.stock} onChange={(e) => setVariant(i, { stock: e.target.value.replace(/\D/g, "") })} placeholder="库存" />
                      )}
                      <button type="button" className="btn plain critical" aria-label="删除规格" disabled={variants.length === 1} onClick={() => setVariants((vs) => vs.filter((_, n) => n !== i))}>
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <button
                  type="button"
                  className="btn plain"
                  onClick={() => {
                    if (!multi) setDimension("规格");
                    setVariants((vs) => [...vs, { id: null, value: "", price: vs.at(-1)?.price ?? "", stock: fulfillment === "shipping" ? "10" : "" }]);
                  }}
                >
                  + {multi ? "再加一个规格" : "有多个规格？比如大小、套餐"}
                </button>
              </div>
            </Card>

            <Card title="下单时要问顾客的">
              <p className="subtle">比如美甲的颜色、蛋糕上写的字。顾客下单时会填，订单里能看到。</p>
              {options.map((o, i) => (
                <div key={o.key} className="option-box">
                  <div className="grid-2">
                    <Field label="问什么">
                      <input className="input" value={o.label} onChange={(e) => setOption(i, { label: e.target.value })} placeholder="比如：颜色" />
                    </Field>
                    <Field label="怎么回答">
                      <select className="select" value={o.type} onChange={(e) => setOption(i, { type: e.target.value as OptionRow["type"] })}>
                        <option value="choice">从选项里选</option>
                        <option value="text">自己填写</option>
                      </select>
                    </Field>
                  </div>
                  {o.type === "choice" && (
                    <Field label="选项" help="用顿号或逗号隔开">
                      <input className="input" value={o.choices} onChange={(e) => setOption(i, { choices: e.target.value })} placeholder="裸粉、酒红、奶白" />
                    </Field>
                  )}
                  <div className="row between">
                    <label className="check">
                      <input type="checkbox" checked={o.required} onChange={(e) => setOption(i, { required: e.target.checked })} />
                      必须回答
                    </label>
                    <button type="button" className="btn plain critical" onClick={() => setOptions((os) => os.filter((_, n) => n !== i))}>
                      删除这个问题
                    </button>
                  </div>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="btn plain"
                  onClick={() => setOptions((os) => [...os, { key: `q${Date.now().toString(36)}`, label: "", type: "choice", choices: "", required: true }])}
                >
                  + 添加问题
                </button>
              </div>
            </Card>

            <Card title="展示信息">
              <p className="subtle">显示在商品页上，比如时长、保质期、适合人群。</p>
              {info.map((x, i) => (
                <div key={i} className="variant-row">
                  <input className="input" value={x.label} onChange={(e) => setInfo((xs) => xs.map((y, n) => (n === i ? { ...y, label: e.target.value } : y)))} placeholder="名称，比如：保质期" />
                  <input className="input" value={x.value} onChange={(e) => setInfo((xs) => xs.map((y, n) => (n === i ? { ...y, value: e.target.value } : y)))} placeholder="内容，比如：15 天" />
                  <button type="button" className="btn plain critical" onClick={() => setInfo((xs) => xs.filter((_, n) => n !== i))}>
                    删除
                  </button>
                </div>
              ))}
              <div>
                <button type="button" className="btn plain" onClick={() => setInfo((xs) => [...xs, { label: "", value: "" }])}>
                  + 添加一条
                </button>
              </div>
            </Card>
          </div>

          <div className="col">
            <Card title="状态">
              <select className="select" value={published ? "on" : "off"} onChange={(e) => setPublished(e.target.value === "on")}>
                <option value="on">上架，顾客可以下单</option>
                <option value="off">下架，顾客看不到</option>
              </select>
            </Card>
            <Card title="怎么卖">
              <label className="check">
                <input type="radio" name="fulfillment" checked={fulfillment === "booking"} disabled={!hasBooking} onChange={() => setFulfillment("booking")} />
                <span>
                  <strong>预约服务</strong>
                  <div className="subtle">{hasBooking ? "顾客选一个时间段到店" : "店铺没有开启预约"}</div>
                </span>
              </label>
              <label className="check">
                <input type="radio" name="fulfillment" checked={fulfillment === "shipping"} onChange={() => setFulfillment("shipping")} />
                <span>
                  <strong>快递发货</strong>
                  <div className="subtle">顾客填地址，你来发货</div>
                </span>
              </label>
              {fulfillment === "booking" && (
                <Field label="服务时长">
                  <select
                    className="select"
                    value={duration}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      // Keep the displayed 时长 line in step with the real duration.
                      setInfo((xs) => xs.map((x) => (x.label === "时长" && x.value === `约 ${duration} 分钟` ? { ...x, value: `约 ${next} 分钟` } : x)));
                      setDuration(next);
                    }}
                  >
                    {(DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b)).map((d) => (
                      <option key={d} value={d}>
                        {d < 60 ? `${d} 分钟` : d % 60 ? `${Math.floor(d / 60)} 小时 ${d % 60} 分钟` : `${d / 60} 小时`}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </Card>
            {existing && (
              <button type="button" className="btn critical" onClick={() => void remove()}>
                删除商品
              </button>
            )}
          </div>
        </div>
      </Page>
    </form>
  );
}
