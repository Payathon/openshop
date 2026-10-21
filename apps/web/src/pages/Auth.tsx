import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { message, post } from "../api.ts";
import { Banner, Card, Field } from "../ui.tsx";

function AuthFrame(props: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="centered">
      <div className="auth-card stack">
        <div className="brand">
          <img src="/admin/icon.svg" alt="" />
          OpenShop
        </div>
        <Card>
          <div className="stack" style={{ gap: 4 }}>
            <h1>{props.title}</h1>
            <p className="muted">{props.subtitle}</p>
          </div>
          {props.children}
        </Card>
        <p className="muted" style={{ textAlign: "center" }}>
          {props.footer}
        </p>
      </div>
    </div>
  );
}

export function Login(props: { onSignedIn: () => Promise<void> }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/login", { email, password });
      await props.onSignedIn();
      navigate(params.get("next") ?? "/", { replace: true });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="登录"
      subtitle="管理你的店铺、商品和订单"
      footer={
        <>
          还没有店？<Link to="/register">免费开店</Link>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        {error && <Banner tone="critical">{error}</Banner>}
        <Field label="邮箱">
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="密码">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="btn primary large block" disabled={busy}>
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </AuthFrame>
  );
}

export function Register(props: { onSignedIn: () => Promise<void> }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/register", { name, email, password });
      await props.onSignedIn();
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="免费开店"
      subtitle="几分钟搭好你自己的店铺网站，顾客和他们的 AI 助手都能直接下单"
      footer={
        <>
          已有账号？<Link to="/login">登录</Link>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        {error && <Banner tone="critical">{error}</Banner>}
        <Field label="你的称呼">
          <input className="input" autoComplete="name" required maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="邮箱" help="用来登录">
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="密码" help="至少 8 位">
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="btn primary large block" disabled={busy}>
          {busy ? "创建中…" : "创建账号"}
        </button>
      </form>
    </AuthFrame>
  );
}
