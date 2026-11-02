import { AlipayPagePayProvider } from "./alipay.ts";
import { FakePaymentProvider } from "./fake.ts";
import type { PaymentProvider } from "./provider.ts";

// Two separate Alipay apps. ALIPAY_* takes customers' payments for shops; PLATFORM_ALIPAY_*
// takes merchants' 专业版 payments to OpenShop's own account. They must never be the same
// account: customers' money passing through the platform's account is 二清. Without an APPID,
// each falls back to its own fake cashier.
const NOTIFY_PATHS = { ALIPAY: "/payments/alipay/notify", PLATFORM_ALIPAY: "/payments/platform-alipay/notify" };

export function alipayFromEnv(prefix: keyof typeof NOTIFY_PATHS, baseUrl: string): PaymentProvider {
  if (!process.env[`${prefix}_APP_ID`]) return new FakePaymentProvider(baseUrl);
  const need = (name: string) => {
    const v = process.env[name]?.trim();
    if (!v) throw new Error(`${prefix}_APP_ID is set but ${name} is missing`);
    return v;
  };
  return new AlipayPagePayProvider({
    appId: need(`${prefix}_APP_ID`),
    privateKey: need(`${prefix}_PRIVATE_KEY`),
    alipayPublicKey: need(`${prefix}_PUBLIC_KEY`),
    gateway: process.env[`${prefix}_GATEWAY`] || undefined,
    // Alipay can only reach a public HTTPS address; locally, results come from query alone.
    notifyUrl: baseUrl.startsWith("https://") ? `${baseUrl}${NOTIFY_PATHS[prefix]}` : undefined,
  });
}
