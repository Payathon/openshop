// Refunds one 专业版 payment in full. There is no platform admin UI; the operator runs this
// with the same environment as the server, so it uses the same database and PLATFORM_ALIPAY_* app:
//   docker compose exec app node --import tsx src/billing-refund.ts bill_…
//   pnpm --filter @openshop/server billing:refund bill_…   (locally)
import { Billing } from "./billing.ts";
import { connectFromEnv } from "./db/client.ts";
import { alipayFromEnv } from "./payments/env.ts";
import { ShopError } from "./shop.ts";

const id = process.argv[2];
if (!id?.startsWith("bill_")) {
  console.error("usage: billing-refund.ts <bill_… payment id>");
  process.exit(2);
}

const baseUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8788}`;
const payments = alipayFromEnv("PLATFORM_ALIPAY", baseUrl);
const billing = new Billing({ db: await connectFromEnv(), payments, baseUrl });

try {
  const { payment, refundedNow, proUntil } = await billing.refund(id);
  console.log(refundedNow ? `refunded ${payment.id} (¥${(payment.amountFen / 100).toFixed(2)}) via ${payments.name}` : `${payment.id} was already refunded at ${payment.refundedAt}`);
  console.log(`shop's 专业版 now ends: ${proUntil ?? "never had one"}`);
  process.exit(0);
} catch (err) {
  console.error(err instanceof ShopError ? `${err.code}: ${err.message}` : err);
  process.exit(1);
}
