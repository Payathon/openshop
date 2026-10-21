import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { get, isUnauthorized, post } from "./api.ts";
import { Login, Register } from "./pages/Auth.tsx";
import { Customers } from "./pages/Customers.tsx";
import { Design } from "./pages/Design.tsx";
import { Home } from "./pages/Home.tsx";
import { Onboarding } from "./pages/Onboarding.tsx";
import { OrderDetail, Orders } from "./pages/Orders.tsx";
import { ProductEdit, Products } from "./pages/Products.tsx";
import { Schedule } from "./pages/Schedule.tsx";
import { Settings } from "./pages/Settings.tsx";
import { SessionContext, type Me } from "./session.tsx";
import { Shell } from "./Shell.tsx";
import { ToastHost } from "./ui.tsx";
import "./styles.css";

type State = { kind: "loading" } | { kind: "signed-out" } | { kind: "failed" } | { kind: "signed-in"; me: Me };

function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const navigate = useNavigate();
  const location = useLocation();

  const refresh = useCallback(async () => {
    try {
      setState({ kind: "signed-in", me: await get<Me>("/api/auth/me") });
    } catch (err) {
      setState(isUnauthorized(err) ? { kind: "signed-out" } : { kind: "failed" });
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const logout = useCallback(async () => {
    await post("/api/auth/logout").catch(() => {});
    setState({ kind: "signed-out" });
    navigate("/login", { replace: true });
  }, [navigate]);

  if (state.kind === "loading") return <div className="empty">加载中…</div>;
  if (state.kind === "failed") return <div className="empty">连不上服务器，请稍后刷新</div>;

  if (state.kind === "signed-out") {
    return (
      <Routes>
        <Route path="/login" element={<Login onSignedIn={refresh} />} />
        <Route path="/register" element={<Register onSignedIn={refresh} />} />
        <Route path="*" element={<Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />} />
      </Routes>
    );
  }

  const { me } = state;
  // Signed in without a shop yet: onboarding is the only place to go.
  if (!me.shop) {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding onDone={refresh} />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  return (
    <SessionContext.Provider value={{ me, shop: me.shop, refresh, logout }}>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/new" element={<ProductEdit />} />
          <Route path="/products/:id" element={<ProductEdit />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/design" element={<Design />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/register" element={<Navigate to="/" replace />} />
          <Route path="/onboarding" element={<Navigate to="/" replace />} />
          <Route path="*" element={<div className="empty">页面不存在</div>} />
        </Routes>
      </Shell>
    </SessionContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <ToastHost>
        <App />
      </ToastHost>
    </BrowserRouter>
  </StrictMode>,
);
