import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it } from "vitest";
import { createMcpServer } from "./mcp.ts";
import { freshHome, nextSaturday, startTestServer } from "./test-server.ts";

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

const customer = { name: "王小姐", phone: "13700000000" };

async function connect(transport: Parameters<Client["connect"]>[0]) {
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(transport);
  cleanups.push(() => mcp.close());
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = r.content[0]!.text;
    if (r.isError) throw new Error(text);
    return JSON.parse(text);
  };
  const fails = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await mcp.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    expect(r.isError).toBe(true);
    return r.content[0]!.text;
  };
  return { mcp, call, fails };
}

async function local() {
  const server = await startTestServer();
  cleanups.push(server.stop);
  await freshHome();
  process.env.OPENSHOP_MCP_WAIT_MS = "5000";
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  // A default server that doesn't exist: share links must carry their own host.
  await createMcpServer("http://127.0.0.1:9").connect(serverSide);
  return { ...server, ...(await connect(clientSide)), link: `${server.base}/s/nail-studio` };
}

it("books a nail appointment from a share link and follows it until paid", async () => {
  const t = await local();

  const opened = await t.call("shop_open", { shop: t.link });
  expect(opened.shop.name).toBe("小美美甲工作室");
  expect(opened.shop.hours[0]).toBe("周二 10:00–20:00");
  const french = opened.products.find((p: { name: string }) => p.name === "法式美甲");
  expect(french.variants[0].price).toBe("¥168.00");
  expect(french.orderOptions[0]).toMatchObject({ key: "color", required: true });

  const date = nextSaturday();
  const slots = await t.call("shop_get_availability", { shop: t.link, variant_id: french.variants[0].id, date });
  expect(slots.date).toBe(`${date} 周六`);
  const two = slots.slots.find((s: { time: string }) => s.time === "14:00–15:30");
  expect(two.start).toBe(`${date}T14:00:00+08:00`);

  const order = await t.call("shop_create_order", {
    shop: t.link,
    items: [{ variant_id: french.variants[0].id, options: { color: "裸粉" } }],
    customer,
    slot_start: two.start,
  });
  expect(order).toMatchObject({ status: "pending_payment", total: "¥168.00", slot: `${date} 周六 14:00–15:30` });
  // The token stays on disk locally; the agent never needs it.
  expect(order.accessToken).toBeUndefined();

  // The slot is held while unpaid.
  const after = await t.call("shop_get_availability", { shop: t.link, variant_id: french.variants[0].id, date });
  expect(after.slots.some((s: { time: string }) => s.time === "14:00–15:30")).toBe(false);

  await t.pay(order.paymentUrl);
  const paid = await t.call("shop_get_order", { order_id: order.id, wait: true });
  expect(paid).toMatchObject({ status: "confirmed", statusText: "预约成功" });
  expect(paid.paymentUrl).toBeUndefined();

  const mine = await t.call("shop_list_orders");
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ shop: "小美美甲工作室", id: order.id, status: "confirmed" });
});

it("asks for what the product needs before taking the order", async () => {
  const t = await local();
  const { products } = await t.call("shop_open", { shop: t.link });
  const french = products.find((p: { name: string }) => p.name === "法式美甲");
  const date = nextSaturday();

  expect(
    await t.fails("shop_create_order", { shop: t.link, items: [{ variant_id: french.variants[0].id }], customer, slot_start: `${date}T14:00:00+08:00` }),
  ).toContain("颜色");
  expect(await t.fails("shop_create_order", { shop: t.link, items: [{ variant_id: french.variants[0].id, options: { color: "裸粉" } }], customer })).toContain(
    "slot_required",
  );
  expect(await t.fails("shop_open", { shop: "https://example.com/menu" })).toContain("不是 OpenShop 店铺链接");
});

it("keeps the customer's profile on this computer", async () => {
  const t = await local();
  expect(await t.call("profile_get")).toEqual({});
  await t.call("profile_save", { name: "王小姐", phone: "13700000000" });
  const address = { recipient: "王小姐", phone: "13700000000", region: "浙江省杭州市西湖区", detail: "文一路 100 号" };
  expect(await t.call("profile_save", { addresses: [address] })).toEqual({ ...customer, addresses: [address] });
  expect(await t.fails("profile_save", { phone: "123" })).toBeTruthy();
});

it("serves the same tools remotely, where the agent keeps the order's access token", async () => {
  const server = await startTestServer();
  cleanups.push(server.stop);
  // The SDK's own transport types don't satisfy exactOptionalPropertyTypes.
  const transport = new StreamableHTTPClientTransport(new URL(`${server.base}/mcp`)) as unknown as Parameters<Client["connect"]>[0];
  const t = await connect(transport);

  const names = (await t.mcp.listTools()).tools.map((x) => x.name);
  expect(names).toContain("shop_create_order");
  expect(names.some((n) => n.startsWith("profile_"))).toBe(false);

  // Remote shops are this server's own, whatever host the link names.
  const { products } = await t.call("shop_open", { shop: "https://elsewhere.example/s/bakery" });
  const cookie = products[0];
  expect(cookie.variants.map((v: { stock: number }) => v.stock)).toEqual([20, 10]);

  const address = { recipient: "王小姐", phone: "13700000000", region: "浙江省杭州市西湖区", detail: "文一路 100 号" };
  const order = await t.call("shop_create_order", { shop: "bakery", items: [{ variant_id: cookie.variants[1].id, quantity: 2 }], customer, address });
  expect(order.total).toBe("¥136.00");
  expect(order.accessToken).toMatch(/^oso_/);

  expect(await t.fails("shop_get_order", { order_id: order.id })).toBeTruthy();
  await server.pay(order.paymentUrl);
  expect(await t.call("shop_get_order", { order_id: order.id, access_token: order.accessToken })).toMatchObject({ status: "paid" });

  const cancelled = await t.call("shop_cancel_order", { order_id: order.id, access_token: order.accessToken });
  expect(cancelled).toMatchObject({ status: "cancelled", refunded: true });
});
