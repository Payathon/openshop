import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { connectPglite, connectPostgres } from "./db/client.ts";
import { FakePaymentProvider } from "./payments/fake.ts";
import { seedDemo } from "./seed.ts";
import { OpenShop } from "./shop.ts";

const port = Number(process.env.PORT ?? 8788);
const baseUrl = process.env.PUBLIC_URL ?? `http://localhost:${port}`;

// DATABASE_URL selects Postgres; without it, an in-process PGlite database under .data/.
const db = process.env.DATABASE_URL
  ? await connectPostgres(process.env.DATABASE_URL)
  : await connectPglite(process.env.PGLITE_DIR ?? ".data/pglite");

// Real Alipay comes in M5; until then every payment goes through the fake cashier.
const payments = new FakePaymentProvider(baseUrl);
const shop = new OpenShop({ db, payments, baseUrl });

if (process.env.SEED !== "0") {
  const tokens = await seedDemo(shop);
  if (tokens) console.log("seeded demo shops; merchant tokens:", tokens);
}

// Signs merchants' preview links. Unset, a random one is used and links die on restart.
const previewSecret = process.env.PREVIEW_SECRET;
if (!previewSecret) console.warn("PREVIEW_SECRET is not set; preview links stop working when the server restarts");

serve({ fetch: createApp(shop, payments, { previewSecret }).fetch, port }, () => console.log(`openshop listening on ${baseUrl}`));
