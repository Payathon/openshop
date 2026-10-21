import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Link } from "react-router";

// Small building blocks for the workbench. Styles live in styles.css.

export function Page(props: {
  title: ReactNode;
  back?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={props.narrow ? "page narrow" : "page"}>
      <div className="page-header">
        {props.back && (
          <Link className="back" to={props.back} aria-label="返回">
            ←
          </Link>
        )}
        <div className="title">
          <h1>{props.title}</h1>
          {props.badge}
        </div>
        {props.actions && <div className="actions">{props.actions}</div>}
      </div>
      {props.children}
    </div>
  );
}

export function Card(props: { title?: ReactNode; action?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    <section className={props.flush ? "card flush" : "card"}>
      {(props.title || props.action) && (
        <div className="card-header">
          {typeof props.title === "string" ? <h2>{props.title}</h2> : props.title}
          {props.action}
        </div>
      )}
      {props.children}
    </section>
  );
}

type Tone = "success" | "warning" | "critical" | "info";

export function Badge(props: { tone?: Tone; children: ReactNode }) {
  return <span className={props.tone ? `badge ${props.tone}` : "badge"}>{props.children}</span>;
}

export function Banner(props: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={props.tone ? `banner ${props.tone}` : "banner"} role={props.tone === "critical" ? "alert" : "status"}>
      <div className="body">
        {props.title && <h3>{props.title}</h3>}
        {props.children}
      </div>
      {props.action}
    </div>
  );
}

export function Field(props: { label: string; help?: ReactNode; error?: string | null | undefined; children: ReactNode }) {
  return (
    <div className="field">
      <label>
        {props.label}
        <div style={{ marginTop: 4 }}>{props.children}</div>
      </label>
      {props.error ? <div className="error">{props.error}</div> : props.help && <div className="help">{props.help}</div>}
    </div>
  );
}

export function Empty(props: { children: ReactNode }) {
  return <div className="empty">{props.children}</div>;
}

// ---- toasts ---------------------------------------------------------------

type Toast = { id: number; text: string; critical: boolean };
const ToastContext = createContext<(text: string, opts?: { critical?: boolean }) => void>(() => {});

export function ToastHost(props: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((text: string, opts?: { critical?: boolean }) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, critical: opts?.critical ?? false }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {props.children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={t.critical ? "toast critical" : "toast"}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---- formatting -----------------------------------------------------------

export const yuan = (fen: number) => `¥${(fen / 100).toFixed(2).replace(/\.00$/, "")}`;

// "168" or "168.5" -> 16800 / 16850; null when it isn't a price.
export function parseYuan(s: string): number | null {
  const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

const BEIJING = { timeZone: "Asia/Shanghai" } as const;

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { ...BEIJING, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString("zh-CN", { ...BEIJING, hour: "2-digit", minute: "2-digit" });
