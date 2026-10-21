import { useEffect, useState, type FormEvent } from "react";
import { get, message, post } from "../api.ts";
import { useSession } from "../session.tsx";
import { useStudio } from "../studio.tsx";
import { Badge, Card, Empty, Field, Page, dateTime, useToast } from "../ui.tsx";

interface Publish {
  version: number;
  changes: string[];
  createdAt: string;
}

function ShopInfo() {
  const { overview, propose } = useStudio();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [cancelHours, setCancelHours] = useState(24);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!overview) return;
    setName(overview.shop.name);
    setDescription(overview.shop.description);
    setPhone(overview.shop.phone);
    setAddress(overview.shop.address ?? "");
    setCancelHours(overview.shop.cancelPolicy.freeCancelHoursBefore);
  }, [overview]);
  if (!overview) return null;
  const s = overview.shop;

  async function save(e: FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    if (name.trim() !== s.name) patch.name = name.trim();
    if (description.trim() !== s.description) patch.description = description.trim();
    if (phone !== s.phone) patch.phone = phone;
    if ((address.trim() || null) !== s.address) patch.address = address.trim() || null;
    if (s.hours && cancelHours !== s.cancelPolicy.freeCancelHoursBefore) patch.cancelPolicy = { freeCancelHoursBefore: cancelHours };
    if (Object.keys(patch).length === 0) return;
    setBusy(true);
    await propose({ kind: "shop.update", patch });
    setBusy(false);
  }

  return (
    <Card title="店铺信息" action={<Badge>发布后生效</Badge>}>
      <form className="stack" onSubmit={save}>
        <Field label="店名">
          <input className="input" required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="介绍">
          <textarea className="textarea" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一两句话介绍你的店" />
        </Field>
        <div className="grid-2">
          <Field label="联系电话">
            <input className="input" required inputMode="numeric" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="地址">
            <input className="input" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
        {s.hours && (
          <Field label="免费取消" help="在这个时间之前取消预约，系统自动全额退款；之后要顾客联系你">
            <select className="select" value={cancelHours} onChange={(e) => setCancelHours(Number(e.target.value))}>
              {[0, 2, 6, 12, 24, 48, 72].map((h) => (
                <option key={h} value={h}>
                  {h === 0 ? "预约开始前都可以取消" : `预约开始前 ${h} 小时`}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div>
          <button className="btn primary" disabled={busy}>
            保存
          </button>
        </div>
      </form>
    </Card>
  );
}

function History() {
  const { overview, refresh } = useStudio();
  const toast = useToast();
  const [items, setItems] = useState<Publish[] | null>(null);
  const version = overview?.version;
  useEffect(() => {
    get<Publish[]>("/api/merchant/publishes").then(setItems, () => setItems([]));
  }, [version]);

  async function rollback(v: number) {
    if (!confirm(`把店铺恢复成版本 ${v} 的样子？库存和订单不受影响。`)) return;
    try {
      await post(`/api/merchant/publishes/${v}/rollback`);
      await refresh();
      toast(`已恢复到版本 ${v}`);
    } catch (e) {
      toast(message(e), { critical: true });
    }
  }

  return (
    <Card flush title="发布记录">
      {!items ? (
        <Empty>加载中…</Empty>
      ) : items.length === 0 ? (
        <Empty>还没有发布过</Empty>
      ) : (
        <div className="list">
          {items.map((p, i) => (
            <div key={p.version} className="history-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row">
                  <strong>版本 {p.version}</strong>
                  {i === 0 && <Badge tone="success">当前</Badge>}
                  <span className="subtle">{dateTime(p.createdAt)}</span>
                </div>
                <div className="subtle">{p.changes.slice(0, 4).join("；")}{p.changes.length > 4 ? ` 等 ${p.changes.length} 处` : ""}</div>
              </div>
              {i > 0 && (
                <button className="btn" onClick={() => void rollback(p.version)}>
                  恢复
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function Settings() {
  const { me, shop, logout } = useSession();
  return (
    <Page title="设置">
      <div className="layout">
        <div className="col">
          <ShopInfo />
          <History />
        </div>
        <div className="col">
          <Card title="店铺地址">
            <div className="link-box">{shop.url}</div>
            <p className="subtle">店铺地址开店时生成，暂时不能修改。</p>
          </Card>
          <Card title="账号">
            <div className="stack" style={{ gap: 2 }}>
              <div>{me.account.name}</div>
              <div className="subtle">{me.account.email}</div>
            </div>
            <div>
              <button className="btn" onClick={() => void logout()}>
                退出登录
              </button>
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}
