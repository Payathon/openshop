import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { connectPglite, connectPostgres } from "./db/client.ts";
import { startPaymentSync } from "./jobs.ts";
import { FakePaymentProvider } from "./payments/fake.ts";
import { seedDemo } from "./seed.ts";
import { OpenShop } from "./shop.ts";
import { LocalDiskStorage } from "./storage.ts";

const port = Number(process.env.PORT ?? 8788);
const baseUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

// DATABASE_URL selects Postgres; without it, an in-process PGlite database under .data/.
const db = process.env.DATABASE_URL
  ? await connectPostgres(process.env.DATABASE_URL)
  : await connectPglite(process.env.PGLITE_DIR ?? ".data/pglite");

// Real Alipay comes in M5; until then every payment goes through the fake cashier.
const payments = new FakePaymentProvider(baseUrl);
const shop = new OpenShop({ db, payments, baseUrl });
const storage = new LocalDiskStorage(process.env.UPLOADS_DIR ?? ".data/uploads", `${baseUrl}/files`);

if (process.env.SEED !== "0") {
  const tokens = await seedDemo(shop);
  if (tokens) console.log("seeded demo shops; merchant tokens:", tokens);
}

// Signs merchants' preview links. Unset, a random one is used and links die on restart.
const previewSecret = process.env.PREVIEW_SECRET;
if (!previewSecret) console.warn("PREVIEW_SECRET is not set; preview links stop working when the server restarts");

const jobs = startPaymentSync(shop, Number(process.env.PAYMENT_SYNC_MS ?? 10_000));
const server = serve({ fetch: createApp(shop, payments, { storage, previewSecret }).fetch, port }, () => console.log(`openshop listening on ${baseUrl}`));

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
    process.exit(0);
  });
}
