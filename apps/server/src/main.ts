import Anthropic from "@anthropic-ai/sdk";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { Billing, DEMO_GRANT_DAYS } from "./billing.ts";
import { connectFromEnv } from "./db/client.ts";
import { startPaymentSync } from "./jobs.ts";
import { FakePaymentProvider } from "./payments/fake.ts";
import { alipayFromEnv } from "./payments/env.ts";
import { seedDemo } from "./seed.ts";
import { DEMO, DINING, FASHION, seedAccounts, TRY } from "./seed-accounts.ts";
import { Push, vapidFromEnv, WebPushSender } from "./push.ts";
import { OpenShop } from "./shop.ts";
import { LocalDiskStorage } from "./storage.ts";

const port = Number(process.env.PORT ?? 8788);
const baseUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

const db = await connectFromEnv();

const payments = alipayFromEnv("ALIPAY", baseUrl);
const billingPayments = alipayFromEnv("PLATFORM_ALIPAY", baseUrl);
console.log(`payments: ${payments.name}, billing: ${billingPayments.name}`);
// New-order notifications to merchants' browsers. Without VAPID_* keys, a pair for this run.
const vapid = vapidFromEnv();
const push = new Push({ db, sender: new WebPushSender(vapid), publicKey: vapid.publicKey });
const shop = new OpenShop({ db, payments, baseUrl, notifier: push });
const billing = new Billing({ db, payments: billingPayments, baseUrl });
const storage = new LocalDiskStorage(process.env.UPLOADS_DIR ?? ".data/uploads", `${baseUrl}/files`);

if (process.env.SEED !== "0") {
  const tokens = await seedDemo(shop);
  if (tokens) console.log("seeded demo shops; merchant tokens:", tokens);
}

// Signs merchants' preview links. Unset, a random one is used and links die on restart.
const previewSecret = process.env.PREVIEW_SECRET;
if (!previewSecret) console.warn("PREVIEW_SECRET is not set; preview links stop working when the server restarts");

const jobs = startPaymentSync([shop, billing], Number(process.env.PAYMENT_SYNC_MS ?? 10_000));
// The workbench's AI assistant calls Claude from here (product-decisions #13).
const agent = process.env.ANTHROPIC_API_KEY ? { client: new Anthropic(), model: process.env.AGENT_MODEL ?? "claude-opus-5-5" } : undefined;
if (!agent) console.warn("ANTHROPIC_API_KEY is not set; the workbench's AI assistant is off");

const app = createApp(shop, payments, { storage, previewSecret, billing, push, agent });

// The merchant workbench (apps/web) is served under /admin once built; `pnpm dev` in apps/web
// serves it with hot reload instead and proxies everything else here.
const webDist = process.env.WEB_DIST ?? "../web/dist";
const site = new Hono().route("/", app);
if (existsSync(webDist)) {
  const rewrite = (path: string) => path.replace(/^\/admin/, "");
  site.use("/admin/*", serveStatic({ root: webDist, rewriteRequestPath: rewrite }));
  // Client-side routes get the app shell.
  site.get("/admin/*", serveStatic({ root: webDist, path: "index.html" }));
}

// The demo accounts have published passwords, so they are only made outside production
// unless SEED_ACCOUNTS=1 asks for them.
const seedAccountsWanted = process.env.SEED_ACCOUNTS ? process.env.SEED_ACCOUNTS === "1" : process.env.NODE_ENV !== "production";
if (process.env.SEED !== "0" && seedAccountsWanted && (await seedAccounts(app, baseUrl, { pay: payments instanceof FakePaymentProvider, grant: (slug) => billing.grant(slug, DEMO_GRANT_DAYS) }))) {
  console.log(`seeded workbench accounts (${baseUrl}/admin):`);
  for (const a of [DEMO, FASHION, DINING]) console.log(`  finished shop: ${a.email} / ${a.password}  → ${baseUrl}/s/${a.slug}`);
  console.log(`  new merchant:  ${TRY.email} / ${TRY.password}`);
}

const server = serve({ fetch: site.fetch, port }, () => console.log(`openshop listening on ${baseUrl}`));

// docker stop sends SIGTERM: finish the sweep and in-flight requests, then exit before the kill.
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down`);
    const forced = setTimeout(() => process.exit(1), 8_000);
    forced.unref();
    server.close();
    await jobs.stop();
    await push.idle();
    process.exit(0);
  });
}
