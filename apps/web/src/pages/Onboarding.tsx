import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { get, message, post } from "../api.ts";
import { Banner, Card, Field } from "../ui.tsx";

// product-decisions #6: pick an industry and modules, fill in the basics, and get a working
// site with sample content right away.

interface Templates {
  industries: { key: string; label: string; modules: string[] }[];
  modules: Record<string, string>;
}

const EMOJI: Record<string, string> = { nail: "💅", hair: "💇", fitness: "🏋️", photo: "📷", bakery: "🍪", generic: "🏪" };

const MODULE_HELP: Record<string, string> = {
  booking: "顾客选时间预约，比如美甲、理发、私教课",
  shopping: "顾客下单买东西，你来发快递",
  banner: "首页顶部的活动横幅，比如新客 9 折",
  gallery: "放作品照片、店内环境",
  text: "一段文字介绍你和你的店",
};

export function Onboarding(props: { onDone: () => Promise<void> }) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Templates | null>(null);
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState<string | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<Templates>("/api/templates").then(setTemplates, (e) => setError(message(e)));
  }, []);

  const pick = (key: string) => {
    setIndustry(key);
    setModules(templates?.industries.find((i) => i.key === key)?.modules ?? []);
    setStep(1);
  };
  const toggle = (m: string) => setModules((ms) => (ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m]));
  const sells = modules.includes("booking") || modules.includes("shopping");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^1\d{10}$/.test(phone)) return setError("手机号是 11 位数字，以 1 开头");
    setBusy(true);
    setError(null);
    try {
      await post("/api/onboarding", {
        industry,
        modules,
        name: name.trim(),
        phone,
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      await props.onDone();
      navigate("/", { replace: true });
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <div className="stack" style={{ width: "100%", maxWidth: 640 }}>
        <div className="brand">
          <img src="/admin/icon.svg" alt="" />
          开一家店
        </div>
        <div className="steps" aria-label={`第 ${step + 1} 步，共 3 步`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i <= step ? "done" : ""} />
          ))}
        </div>
        {error && <Banner tone="critical">{error}</Banner>}

        {step === 0 && (
          <Card title="你的店是做什么的？">
            <p className="muted">选一个最接近的，我们会给你准备好对应的页面和示例商品，之后都能改。</p>
            {templates ? (
              <div className="tiles">
                {templates.industries.map((i) => (
                  <button key={i.key} className={industry === i.key ? "tile selected" : "tile"} onClick={() => pick(i.key)}>
                    <span className="emoji">{EMOJI[i.key] ?? "🏪"}</span>
                    <strong>{i.label}</strong>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">加载中…</p>
            )}
          </Card>
        )}

        {step === 1 && templates && (
          <Card title="店里需要哪些功能？">
            <p className="muted">已经按你的行业勾好了常用的。店铺信息和联系方式每家店都有。</p>
            <div className="stack">
              {Object.entries(templates.modules).map(([key, label]) => (
                <label key={key} className="check">
                  <input type="checkbox" checked={modules.includes(key)} onChange={() => toggle(key)} />
                  <span>
                    <strong>{label}</strong>
                    <div className="subtle">{MODULE_HELP[key]}</div>
                  </span>
                </label>
              ))}
            </div>
            {!sells && <Banner tone="warning">没选“预约”或“购买”的话，顾客只能看，不能下单。</Banner>}
            <div className="row between">
              <button className="btn" onClick={() => setStep(0)}>
                上一步
              </button>
              <button className="btn primary" onClick={() => setStep(2)}>
                下一步
              </button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card title="店铺的基本信息">
            <form className="stack" onSubmit={submit}>
              <Field label="店名">
                <input className="input" required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：小美美甲工作室" autoFocus />
              </Field>
              <Field label="联系电话" help="顾客会在店铺页上看到，用来联系你">
                <input className="input" required inputMode="numeric" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} placeholder="11 位手机号" />
              </Field>
              <Field label="地址（选填）" help={modules.includes("booking") ? "到店服务建议填写，顾客预约成功后会看到" : undefined}>
                <input className="input" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="比如：杭州市西湖区文三路 1 号 2 楼" />
              </Field>
              <Field label="一句话介绍（选填）">
                <input className="input" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="比如：日系美甲，一人工作室，需提前预约" />
              </Field>
              <div className="row between">
                <button type="button" className="btn" onClick={() => setStep(1)}>
                  上一步
                </button>
                <button className="btn primary large" disabled={busy}>
                  {busy ? "正在生成你的店铺…" : "生成我的店铺"}
                </button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
