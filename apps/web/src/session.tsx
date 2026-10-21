import { createContext, useContext } from "react";

export interface Account {
  id: string;
  email: string;
  name: string;
}

export interface ShopSummary {
  id: string;
  slug: string;
  name: string;
  industry: string;
  status: "draft" | "live";
  url: string;
}

export interface Me {
  account: Account;
  // The account's shop; null until onboarding creates it.
  shop: ShopSummary | null;
}

export interface Session {
  me: Me;
  shop: ShopSummary;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside the signed-in area");
  return s;
}
