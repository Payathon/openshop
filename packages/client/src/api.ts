// Thin client for the OpenShop storefront API (the public part customers' agents use).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type FetchImpl = (url: URL, init: RequestInit) => Promise<Response>;

export interface Shop {
  id: string;
  slug: string;
  name: string;
  industry: string;
  description: string;
  phone: string;
  address: string | null;
  schedule: { weekly: { weekday: number; open: string; close: string }[]; capacity: number } | null;
  cancelPolicy: { freeCancelHoursBefore: number };
}

export type OrderOption =
  | { key: string; label: string; type: "choice"; choices: string[]; required: boolean }
  | { key: string; label: string; type: "text"; required: boolean };

export interface Product {
  id: string;
  name: string;
  description: string;
  images: string[];
  fulfillment: "booking" | "shipping";
  durationMinutes: number | null;
  orderOptions: OrderOption[];
  info: { label: string; value: string }[];
  variants: { id: string; attributes: Record<string, string>; priceFen: number; stock: number | null }[];
}

export type Availability =
  | { fulfillment: "booking"; date: string; slots: { start: string; end: string; remaining: number }[] }
  | { fulfillment: "shipping"; stock: number };

export interface Address {
  recipient: string;
  phone: string;
  region: string;
  detail: string;
}

export interface Customer {
  name: string;
  phone: string;
}

export interface NewOrder {
  items: { variantId: string; quantity?: number; options?: Record<string, string> }[];
  customer: Customer;
  slotStart?: string;
  address?: Address;
  source: "agent";
}

export type OrderStatus = "pending_payment" | "confirmed" | "paid" | "shipped" | "completed" | "cancelled" | "expired";

export interface Order {
  id: string;
  status: OrderStatus;
  fulfillment: "booking" | "shipping";
  items: {
    productName: string;
    attributes: Record<string, string>;
    options: Record<string, string>;
    quantity: number;
    unitFen: number;
  }[];
  totalFen: number;
  customer: Customer;
  address: Address | null;
  slotStart: string | null;
  slotEnd: string | null;
  paymentUrl: string | null;
  paymentExpiresAt: string;
  refunded: boolean;
  trackingNo: string | null;
  createdAt: string;
  paidAt: string | null;
}

export class OpenShopClient {
  constructor(
    readonly server: string,
    // The server passes its own app here to serve MCP tools without a network hop.
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  async request<T>(method: string, path: string, opts: { body?: unknown; orderToken?: string } = {}): Promise<T> {
    const res = await this.fetchImpl(new URL(path, this.server), {
      method,
      headers: {
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
        ...(opts.orderToken ? { "x-order-token": opts.orderToken } : {}),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    }).catch((err: Error) => {
      const cause = err.cause instanceof Error ? err.cause.message : err.message;
      throw new ApiError(0, "unreachable", `连不上 ${this.server}（${cause}）`);
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(res.status, "bad_response", `${this.server} 返回的不是 JSON（HTTP ${res.status}），检查地址是否是 OpenShop 店铺`);
    }
    if (!res.ok) {
      const e = data as { error?: string; message?: string } | null;
      throw new ApiError(res.status, e?.error ?? "http_error", e?.message ?? `HTTP ${res.status}`);
    }
    return data as T;
  }

  shop(slug: string) {
    return this.request<Shop>("GET", `/api/s/${enc(slug)}`);
  }

  products(slug: string) {
    return this.request<Product[]>("GET", `/api/s/${enc(slug)}/products`);
  }

  product(slug: string, productId: string) {
    return this.request<Product>("GET", `/api/s/${enc(slug)}/products/${enc(productId)}`);
  }

  availability(slug: string, variantId: string, date?: string) {
    const q = new URLSearchParams({ variantId, ...(date ? { date } : {}) });
    return this.request<Availability>("GET", `/api/s/${enc(slug)}/availability?${q}`);
  }

  createOrder(slug: string, order: NewOrder) {
    return this.request<Order & { accessToken: string }>("POST", `/api/s/${enc(slug)}/orders`, { body: order });
  }

  order(orderId: string, accessToken: string) {
    return this.request<Order>("GET", `/api/orders/${enc(orderId)}`, { orderToken: accessToken });
  }

  cancelOrder(orderId: string, accessToken: string) {
    return this.request<Order>("POST", `/api/orders/${enc(orderId)}/cancel`, { orderToken: accessToken });
  }
}

const enc = encodeURIComponent;
