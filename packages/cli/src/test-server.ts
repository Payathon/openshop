import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "@openshop/server/app";
import { connectPglite } from "@openshop/server/db";
import { FakePaymentProvider } from "@openshop/server/payments/fake";
import { seedDemo } from "@openshop/server/seed";
import { OpenShop } from "@openshop/server/shop";

// A real HTTP server (PGlite, fake payments, the demo shops) so CLI and MCP code runs as in production.
export async function startTestServer() {
  let fetchApp: (req: Request) => Response | Promise<Response> = () => new Response("starting", { status: 503 });
  const server = await new Promise<ServerType>((resolve) => {
    const s = serve({ fetch: (req) => fetchApp(req), port: 0 }, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const payments = new FakePaymentProvider(base);
  const shop = new OpenShop({ db: await connectPglite(), payments, baseUrl: base });
  await seedDemo(shop);
  fetchApp = createApp(shop, payments).fetch;

  // What the customer's confirmation in Alipay does in the fake provider.
  const pay = async (paymentUrl: string) => {
    const res = await fetch(paymentUrl, { method: "POST" });
    if (res.status !== 200) throw new Error(`fake pay failed: ${res.status}`);
  };
  const stop = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      if ("closeAllConnections" in server) server.closeAllConnections();
    });
  return { base, pay, stop };
}

// Points ~/.openshop at a fresh directory for one test.
export async function freshHome() {
  process.env.OPENSHOP_HOME = await mkdtemp(join(tmpdir(), "openshop-"));
  return process.env.OPENSHOP_HOME;
}

// The demo nail studio is open every day but Monday; a Saturday a week or more out is always bookable.
export function nextSaturday() {
  const d = new Date(Date.now() + 8 * 3_600_000 + 7 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}
