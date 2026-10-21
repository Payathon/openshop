import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { main } from "./main.ts";
import { freshHome, nextSaturday, startTestServer } from "./test-server.ts";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  vi.restoreAllMocks();
});

// Runs one command and returns its parsed JSON output.
async function run(...argv: string[]) {
  const out: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((s: string) => void out.push(s));
  try {
    await main(argv);
  } finally {
    log.mockRestore();
  }
  return JSON.parse(out.join("\n"));
}

async function env() {
  const server = await startTestServer();
  cleanups.push(server.stop);
  const home = await freshHome();
  process.env.OPENSHOP_SERVER = server.base;
  process.env.OPENSHOP_STATUS_WAIT_MS = "5000";
  return { ...server, home };
}

it("books with the saved profile and checks the order by id alone", async () => {
  const t = await env();
  const profile = await run("profile", "--set", JSON.stringify({ name: "王小姐", phone: "13700000000" }));
  expect(profile).toEqual({ name: "王小姐", phone: "13700000000" });
  expect((await stat(join(t.home, "profile.json"))).mode & 0o777).toBe(0o600);

  // A bare slug goes to OPENSHOP_SERVER.
  const { products } = await run("shop", "nail-studio");
  const plain = products.find((p: { name: string }) => p.name === "单色美甲");
  const date = nextSaturday();
  const { slots } = await run("slots", "nail-studio", plain.variants[0].id, "--date", date);

  const order = await run(
    "order",
    `${t.base}/s/nail-studio`,
    "--input",
    JSON.stringify({ items: [{ variantId: plain.variants[0].id, options: { color: "酒红" } }], customer: profile, slotStart: slots[0].start }),
  );
  expect(order).toMatchObject({ status: "pending_payment", total: "¥128.00", slot: `${date} 周六 10:00–11:00` });

  await t.pay(order.paymentUrl);
  expect(await run("status", order.id, "--wait")).toMatchObject({ status: "confirmed" });
  expect((await run("orders"))[0]).toMatchObject({ id: order.id, status: "confirmed" });
});

it("filters products and reports stock for shipping", async () => {
  await env();
  expect(await run("products", "bakery", "--query", "黄油")).toHaveLength(1);
  expect(await run("products", "bakery", "--query", "蛋糕")).toHaveLength(0);
  const [cookie] = await run("products", "bakery");
  expect(await run("slots", "bakery", cookie.variants[0].id)).toEqual({ fulfillment: "shipping", stock: 20 });
});

it("explains what's wrong instead of guessing", async () => {
  await env();
  await expect(main(["order", "bakery", "--input", "{oops"])).rejects.toThrow("不是有效的 JSON");
  await expect(main(["status", "ord_unknown"])).rejects.toThrow("accessToken");
  await expect(main(["shop", "no-such-shop"])).rejects.toThrow("找不到店铺");
});
