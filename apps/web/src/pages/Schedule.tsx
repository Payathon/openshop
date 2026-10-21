import { useEffect, useState } from "react";
import { get, message, put } from "../api.ts";
import { useStudio, type Hours, type WeeklyHours } from "../studio.tsx";
import { Badge, Banner, Card, Empty, Field, Page, dateTime, useToast } from "../ui.tsx";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// Weekly hours are content (previewed, then published); closures and stock are operational
// and change at once (tech-plan 预览与发布).

function WeeklyHoursCard(props: { hours: Hours }) {
  const { propose } = useStudio();
  const [days, setDays] = useState<Record<number, WeeklyHours | null>>({});
  const [capacity, setCapacity] = useState(1);
  const [step, setStep] = useState(30);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d: Record<number, WeeklyHours | null> = {};
    for (const w of WEEKDAYS) d[w] = props.hours.weekly.find((h) => h.weekday === w) ?? null;
    setDays(d);
    setCapacity(props.hours.capacity);
    setStep(props.hours.stepMinutes);
  }, [props.hours]);

  const set = (w: number, patch: Partial<WeeklyHours> | null) =>
    setDays((d) => ({ ...d, [w]: patch === null ? null : { weekday: w, open: "10:00", close: "20:00", ...(d[w] ?? {}), ...patch } }));

  async function save() {
    const weekly = WEEKDAYS.map((w) => days[w]).filter((d): d is WeeklyHours => !!d);
    if (weekly.some((d) => d.close <= d.open)) return alert("关门时间要晚于开门时间");
    setBusy(true);
    await propose({ kind: "shop.update", patch: { hours: { weekly, capacity, stepMinutes: step } } });
    setBusy(false);
  }

  return (
    <Card title="每周营业时间" action={<Badge>发布后生效</Badge>}>
      <div className="hours">
        {WEEKDAYS.map((w) => {
          const d = days[w];
          return (
            <div key={w} className="hours-row">
              <label className="check" style={{ width: 84 }}>
                <input type="checkbox" checked={!!d} onChange={(e) => set(w, e.target.checked ? {} : null)} />
                {NAMES[w]}
              </label>
              {d ? (
                <div className="row">
                  <input className="input" type="time" step={1800} value={d.open} onChange={(e) => set(w, { open: e.target.value })} style={{ width: 120 }} />
                  <span className="muted">至</span>
                  <input className="input" type="time" step={1800} value={d.close} onChange={(e) => set(w, { close: e.target.value })} style={{ width: 120 }} />
                </div>
              ) : (
                <span className="muted">休息</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid-2">
        <Field label="同时能接待几位顾客" help="比如有 2 位美甲师就填 2">
          <input className="input" type="number" min={1} max={50} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
        <Field label="预约时间间隔" help="顾客能选的开始时间">
          <select className="select" value={step} onChange={(e) => setStep(Number(e.target.value))}>
            {[15, 30, 60].map((m) => (
              <option key={m} value={m}>
                每 {m} 分钟
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>
          保存营业时间
        </button>
      </div>
    </Card>
  );
}

interface Closure {
  start: string;
  end: string;
}

const beijingIso = (date: string, time: string) => `${date}T${time}:00+08:00`;

function ClosuresCard() {
  const toast = useToast();
  const [closures, setClosures] = useState<Closure[] | null>(null);
  const [date, setDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("14:00");

  useEffect(() => {
    get<{ closures: Closure[] }>("/api/merchant/closures").then((r) => setClosures(r.closures), (e) => toast(message(e), { critical: true }));
  }, [toast]);

  async function save(next: Closure[]) {
    try {
      const r = await put<{ closures: Closure[] }>("/api/merchant/closures", { closures: next });
      setClosures(r.closures);
      toast("已更新，顾客马上就约不到这段时间了");
    } catch (e) {
      toast(message(e), { critical: true });
    }
  }

  function add() {
    if (!date) return toast("先选一个日期", { critical: true });
    const start = beijingIso(date, allDay ? "00:00" : from);
    const end = allDay ? new Date(new Date(beijingIso(date, "00:00")).getTime() + 86_400_000).toISOString() : beijingIso(date, to);
    void save([...(closures ?? []), { start, end }]);
  }

  const upcoming = (closures ?? []).filter((c) => new Date(c.end) > new Date());

  return (
    <Card title="临时休息" action={<Badge tone="success">立即生效</Badge>}>
      <p className="subtle">请假、外出、包场时用。这段时间顾客不能预约，已有的预约不受影响。</p>
      {upcoming.length > 0 && (
        <div className="list">
          {upcoming.map((c) => (
            <div key={c.start} className="row between" style={{ padding: "8px 0" }}>
              <span>
                {dateTime(c.start)} 至 {dateTime(c.end)}
              </span>
              <button className="btn plain critical" onClick={() => void save((closures ?? []).filter((x) => x !== c))}>
                取消休息
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
        <select className="select" value={allDay ? "all" : "part"} onChange={(e) => setAllDay(e.target.value === "all")} style={{ width: 110 }}>
          <option value="all">全天</option>
          <option value="part">部分时间</option>
        </select>
        {!allDay && (
          <>
            <input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 110 }} />
            <span className="muted">至</span>
            <input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 110 }} />
          </>
        )}
        <button className="btn" onClick={add}>
          添加
        </button>
      </div>
    </Card>
  );
}

function StockCard() {
  const { overview, refresh } = useStudio();
  const toast = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const items = (overview?.products ?? []).filter((p) => p.fulfillment === "shipping");
  if (items.length === 0) return null;

  async function save(variantId: string) {
    const stock = Number(edits[variantId]);
    if (!Number.isInteger(stock) || stock < 0) return toast("库存要填 0 或正整数", { critical: true });
    try {
      await put(`/api/merchant/variants/${variantId}/stock`, { stock });
      setEdits(({ [variantId]: _, ...rest }) => rest);
      await refresh();
      toast("库存已更新");
    } catch (e) {
      toast(message(e).includes("找不到") ? "这个规格还没发布，发布后再改库存" : message(e), { critical: true });
    }
  }

  return (
    <Card flush title="库存" action={<Badge tone="success">立即生效</Badge>}>
      <table className="table">
        <thead>
          <tr>
            <th>商品</th>
            <th className="num">库存</th>
          </tr>
        </thead>
        <tbody>
          {items.flatMap((p) =>
            p.variants.map((v) => (
              <tr key={v.id}>
                <td>
                  {p.name}
                  {Object.values(v.attributes).length > 0 && <span className="subtle"> · {Object.values(v.attributes).join(" / ")}</span>}
                  {(v.stock ?? 0) === 0 && (
                    <>
                      {" "}
                      <Badge tone="critical">售罄</Badge>
                    </>
                  )}
                </td>
                <td className="num">
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <input
                      className="input"
                      inputMode="numeric"
                      style={{ width: 80, textAlign: "right" }}
                      value={edits[v.id] ?? String(v.stock ?? 0)}
                      onChange={(e) => setEdits((x) => ({ ...x, [v.id]: e.target.value.replace(/\D/g, "") }))}
                      onKeyDown={(e) => e.key === "Enter" && void save(v.id)}
                    />
                    {edits[v.id] !== undefined && (
                      <button className="btn primary" onClick={() => void save(v.id)}>
                        保存
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </Card>
  );
}

export function Schedule() {
  const { overview } = useStudio();
  if (!overview) return <Page title="营业时间与库存"><Empty>加载中…</Empty></Page>;
  const hours = overview.shop.hours;
  const hasShipping = overview.products.some((p) => p.fulfillment === "shipping");
  return (
    <Page title="营业时间与库存">
      {!hours && !hasShipping && <Banner>店铺没有开启预约，也没有快递商品，这里暂时没有要设置的。</Banner>}
      {hours && <WeeklyHoursCard hours={hours} />}
      {hours && <ClosuresCard />}
      <StockCard />
    </Page>
  );
}
