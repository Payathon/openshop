import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { useSession } from "./session.tsx";
import { StudioProvider, useStudio } from "./studio.tsx";

const icon = (d: string) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

const NAV: { to: string; label: string; icon: ReactNode; end?: boolean }[] = [
  { to: "/", label: "首页", icon: icon("M3 9l7-6 7 6v8H3z M8 17v-5h4v5"), end: true },
  { to: "/orders", label: "订单", icon: icon("M4 3h12v14H4z M7 7h6 M7 10h6 M7 13h4") },
  { to: "/products", label: "商品", icon: icon("M3 7l7-4 7 4v7l-7 4-7-4z M3 7l7 4 7-4 M10 11v7") },
  { to: "/schedule", label: "营业时间与库存", icon: icon("M10 3a7 7 0 1 0 0 14a7 7 0 1 0 0-14z M10 6v4l3 2") },
  { to: "/customers", label: "顾客", icon: icon("M7 9a3 3 0 1 0 0-6a3 3 0 1 0 0 6z M2 17c0-3 2-5 5-5s5 2 5 5 M13 4a3 3 0 0 1 0 5 M15 12c2 .5 3 2 3 5") },
  { to: "/design", label: "店铺装修", icon: icon("M3 4h14v12H3z M3 8h14 M8 8v8") },
  { to: "/settings", label: "设置", icon: icon("M10 7a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M10 2v2 M10 16v2 M2 10h2 M16 10h2 M4.3 4.3l1.4 1.4 M14.3 14.3l1.4 1.4 M4.3 15.7l1.4-1.4 M14.3 5.7l1.4-1.4") },
];

// The bar Shopify calls the contextual save bar: always visible while there is something to
// publish, so the merchant never wonders why customers don't see an edit yet.
function PublishBar() {
  const { overview, publish, undo, discard } = useStudio();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!overview) return null;
  const draft = overview.shop.status === "draft";
  const n = overview.changes.length;
  if (!draft && n === 0) return null;

  const go = async () => {
    setBusy(true);
    if (await publish()) setOpen(false);
    setBusy(false);
  };

  return (
    <div className="publish-bar">
      <div className="publish-bar-row">
        <span className="dot" aria-hidden />
        <span className="text">
          {draft ? "店铺还没上线，顾客暂时看不到" : `${n} 处修改还没发布`}
          {draft && n > 0 && <span className="subtle"> · {n} 处修改</span>}
        </span>
        {n > 0 && (
          <button className="btn plain light" onClick={() => setOpen((o) => !o)}>
            {open ? "收起" : "查看修改"}
          </button>
        )}
        <a className="btn light" href={overview.previewUrl} target="_blank" rel="noreferrer">
          预览
        </a>
        <button className="btn primary" onClick={go} disabled={busy}>
          {busy ? "发布中…" : draft ? "发布上线" : "发布"}
        </button>
      </div>
      {open && n > 0 && (
        <div className="publish-bar-changes">
          {overview.changes.map((c) => (
            <div key={c.id} className="row between">
              <span>{c.summary}</span>
              <button className="btn plain light" onClick={() => void undo(c.id)}>
                撤销
              </button>
            </div>
          ))}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button
              className="btn plain light"
              onClick={() => {
                if (confirm("放弃全部未发布的修改？")) void discard();
              }}
            >
              全部放弃
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Shell(props: { children: ReactNode }) {
  return (
    <StudioProvider>
      <Frame>{props.children}</Frame>
    </StudioProvider>
  );
}

function Frame(props: { children: ReactNode }) {
  const { shop, logout } = useSession();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <header className="topbar">
        <button className="btn plain" onClick={() => setOpen(true)} aria-label="打开菜单">
          ☰
        </button>
        <strong style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shop.name}</strong>
        <a className="btn" href={shop.url} target="_blank" rel="noreferrer">
          查看店铺
        </a>
      </header>
      <nav className={open ? "nav open" : "nav"} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
        <div className="nav-shop">
          <div className="logo">{shop.name.slice(0, 1)}</div>
          <div style={{ minWidth: 0 }}>
            <div className="name">{shop.name}</div>
            <div className="subtle">{shop.status === "live" ? "已上线" : "未上线"}</div>
          </div>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end ?? false} className={({ isActive }) => (isActive ? "active" : "")}>
            {n.icon}
            {n.label}
          </NavLink>
        ))}
        <div className="nav-spacer" />
        <a href={shop.url} target="_blank" rel="noreferrer">
          {icon("M8 4H4v12h12v-4 M11 3h6v6 M17 3l-8 8")}
          查看店铺
        </a>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            void logout();
          }}
        >
          {icon("M8 4H4v12h4 M12 6l4 4-4 4 M16 10H8")}
          退出登录
        </a>
      </nav>
      <main className="main">
        <PublishBar />
        {props.children}
      </main>
    </div>
  );
}
