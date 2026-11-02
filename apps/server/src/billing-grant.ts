// Gives a shop 专业版 for some days without payment, for demo and partner shops. Like
// billing-refund.ts, the operator runs it with the server's environment (same database):
//   docker compose exec app node --import tsx src/billing-grant.ts moon-nail 365
//   pnpm --filter @openshop/server billing:grant moon-nail 365   (locally)
// The grant covers now to now + days; running it again with more days moves the end later.
import { Billing } from "./billing.ts";
import { connectFromEnv } from "./db/client.ts";
import { FakePaymentProvider } from "./payments/fake.ts";
import { ShopError } from "./shop.ts";

const [slug, daysArg] = process.argv.slice(2);
const days = Number(daysArg);
if (!slug || !Number.isInteger(days) || days < 1) {
  console.error("usage: billing-grant.ts <shop slug> <days>");
  process.exit(2);
}

// A grant makes no payment, so no provider is ever called.
const baseUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8788}`;
const billing = new Billing({ db: await connectFromEnv(), payments: new FakePaymentProvider(baseUrl), baseUrl });

try {
  const { shop, grant, plan } = await billing.grant(slug, days);
  console.log(`granted ${shop.name} (${slug}) 专业版 for ${days} days: ${grant.id}, until ${grant.periodEnd.toISOString()}`);
  console.log(`shop's 专业版 now ends: ${plan.until?.toISOString() ?? "—"} (${plan.source})`);
  process.exit(0);
} catch (err) {
  console.error(err instanceof ShopError ? `${err.code}: ${err.message}` : err);
  process.exit(1);
}
