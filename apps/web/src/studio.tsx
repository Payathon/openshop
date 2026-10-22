import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ApiError, del, get, message, post } from "./api.ts";
import { useSession } from "./session.tsx";
import { useToast } from "./ui.tsx";

// What the merchant is editing: the preview content (live + pending changes), the change
// list and the live state, from GET /api/merchant/shop. Every content edit is an op posted to
// /api/merchant/changes; it shows in the preview at once and goes live on publish.

export interface WeeklyHours {
  weekday: number;
  open: string;
  close: string;
}
export interface Hours {
  weekly: WeeklyHours[];
  capacity: number;
  stepMinutes: number;
}

export type OrderOption =
  | { key: string; label: string; type: "choice"; choices: string[]; required: boolean }
  | { key: string; label: string; type: "text"; required: boolean };

export interface Variant {
  id: string;
  attributes: Record<string, string>;
  priceFen: number;
  stock: number | null;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  images: string[];
  fulfillment: "booking" | "shipping";
  durationMinutes: number | null;
  orderOptions: OrderOption[];
  info: { label: string; value: string }[];
  published: boolean;
  sample: boolean;
  variants: Variant[];
}

export interface Section {
  id: string;
  type: string;
  v: number;
  props: Record<string, unknown>;
}

export interface Theme {
  style: "minimal" | "fashion" | "dining" | "beauty";
  primary: string;
  font: "system" | "rounded" | "serif";
  radius: "square" | "soft" | "round";
}

export interface Change {
  id: string;
  summary: string;
  kind: string;
  createdAt: string;
}

export interface Overview {
  shop: {
    id: string;
    slug: string;
    status: "draft" | "live";
    industry: string;
    url: string;
    name: string;
    description: string;
    phone: string;
    address: string | null;
    hours: Hours | null;
    cancelPolicy: { freeCancelHoursBefore: number };
  };
  version: number;
  page: { sections: Section[]; theme: Theme };
  products: Product[];
  changes: Change[];
  previewUrl: string;
}

export type Op =
  | { kind: "shop.update"; patch: Partial<Omit<Overview["shop"], "id" | "slug" | "status" | "industry" | "url">> }
  | { kind: "theme.update"; patch: Partial<Theme> }
  | { kind: "section.add"; section: { type: string; props?: Record<string, unknown> }; index?: number }
  | { kind: "section.update"; id: string; props: Record<string, unknown> }
  | { kind: "section.move"; id: string; index: number }
  | { kind: "section.remove"; id: string }
  | { kind: "product.create"; product: ProductInput }
  | { kind: "product.update"; id: string; product: ProductInput }
  | { kind: "product.delete"; id: string };

export type ProductInput = Omit<Product, "id" | "sample" | "variants"> & { variants: Omit<Variant, "id">[] };

interface StudioValue {
  overview: Overview | null;
  error: string | null;
  refresh: () => Promise<void>;
  // Posts an op; returns false (after showing the error) when it is refused.
  propose: (op: Op, opts?: { quiet?: boolean }) => Promise<boolean>;
  undo: (changeId: string) => Promise<void>;
  discard: () => Promise<void>;
  publish: () => Promise<boolean>;
  // Bumped after every successful edit so previews can reload.
  revision: number;
}

const StudioContext = createContext<StudioValue | null>(null);

export function StudioProvider(props: { children: ReactNode }) {
  const toast = useToast();
  const session = useSession();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setOverview(await get<Overview>("/api/merchant/shop"));
      setError(null);
      setRevision((r) => r + 1);
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const propose = useCallback(
    async (op: Op, opts?: { quiet?: boolean }) => {
      try {
        await post("/api/merchant/changes", op);
        await refresh();
        if (!opts?.quiet) toast("已保存，发布后对顾客生效");
        return true;
      } catch (e) {
        toast(message(e), { critical: true });
        return false;
      }
    },
    [refresh, toast],
  );

  const undo = useCallback(
    async (id: string) => {
      try {
        const r = await del<{ undone: Change[] }>(`/api/merchant/changes/${id}`);
        await refresh();
        toast(r.undone.length > 1 ? `已撤销 ${r.undone.length} 处修改` : "已撤销");
      } catch (e) {
        toast(message(e), { critical: true });
      }
    },
    [refresh, toast],
  );

  const discard = useCallback(async () => {
    try {
      await del("/api/merchant/changes");
      await refresh();
      toast("已放弃全部修改");
    } catch (e) {
      toast(message(e), { critical: true });
    }
  }, [refresh, toast]);

  const publish = useCallback(async () => {
    try {
      const wasLive = overview?.shop.status === "live";
      await post("/api/merchant/publish");
      await refresh();
      await session.refresh();
      toast(wasLive ? "已发布，顾客现在看到的是新版本" : "店铺已上线！");
      return true;
    } catch (e) {
      toast(message(e), { critical: true });
      // Sample products block publishing: take the merchant to where they can fix it.
      if (e instanceof ApiError && e.code === "sample_content") navigate("/products");
      return false;
    }
  }, [overview, refresh, session, toast, navigate]);

  return (
    <StudioContext.Provider value={{ overview, error, refresh, propose, undo, discard, publish, revision }}>{props.children}</StudioContext.Provider>
  );
}

export function useStudio(): StudioValue {
  const s = useContext(StudioContext);
  if (!s) throw new Error("useStudio outside StudioProvider");
  return s;
}

// The loaded overview; pages render a spinner until it is there.
export function useOverview(): Overview | null {
  return useStudio().overview;
}
