import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "./api.ts";
import type { Buyer } from "./buyer.ts";

// The customer-side tools over MCP: served locally by `openshop mcp` (stdio, with the
// customer's profile and order records in ~/.openshop) and remotely by the server's /mcp.

// MCP clients time out long tool calls, so waits are capped and the agent calls again.
const WAIT_MS = Number(process.env.OPENSHOP_MCP_WAIT_MS ?? 45_000);

const INSTRUCTIONS = `OpenShop shops are independent stores (nail salons, studios, bakeries…). You can browse a shop, book a time or buy, and follow the order. You never pay: the user confirms every payment in Alipay.
- Open a shop with shop_open using the link or slug the user gave you.
- Before ordering, ask for anything the product needs (required orderOptions, a slot for bookings, an address for shipping), then show the user a summary (item, time or address, price, name and phone) and order only after they confirm.
- After shop_create_order, hand the paymentUrl to the user exactly as returned, then check with shop_get_order.`;

const LOCAL_RULE = `
- Read the user's saved name, phone and addresses with profile_get. Save with profile_save only after the user agrees.`;

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));

const shopRef = z.string().describe("Shop link (https://…/s/<slug>) or slug, e.g. nail-studio");
const phone = z.string().regex(/^1\d{10}$/, "11-digit mainland mobile number");
const address = z.object({
  recipient: z.string(),
  phone,
  region: z.string().describe("Province, city and district, e.g. 浙江省杭州市西湖区"),
  detail: z.string().describe("Street and door number"),
});

export function createMcpServer(buyer: Buyer) {
  const local = buyer.store !== null;
  const tool =
    <A>(fn: (args: A) => Promise<unknown>) =>
    async (args: A) => {
      try {
        return json(await fn(args));
      } catch (err) {
        const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
        return { ...text(`error: ${msg}`), isError: true };
      }
    };

  const server = new McpServer({ name: "openshop", version: "0.0.0" }, { instructions: INSTRUCTIONS + (local ? LOCAL_RULE : "") });

  server.registerTool(
    "shop_open",
    {
      description: "Open a shop from its share link or slug: shop info, opening hours, cancellation policy, and all products with variants, prices and order options.",
      inputSchema: { shop: shopRef },
      annotations: { readOnlyHint: true },
    },
    tool(({ shop }) => buyer.open(shop)),
  );

  server.registerTool(
    "shop_search_products",
    {
      description: "List a shop's products, optionally filtered by a keyword in the name, description or info.",
      inputSchema: { shop: shopRef, query: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    tool(({ shop, query }) => buyer.products(shop, query)),
  );

  server.registerTool(
    "shop_get_product",
    {
      description: "One product with its variants (each has its own id and price), required order options and display info.",
      inputSchema: { shop: shopRef, product_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    tool(({ shop, product_id }) => buyer.product(shop, product_id)),
  );

  server.registerTool(
    "shop_get_availability",
    {
      description:
        "For a booking variant: free time slots on a date (Beijing time); pass a slot's `start` unchanged as slot_start when ordering. For a shipping variant: stock left (date not needed).",
      inputSchema: {
        shop: shopRef,
        variant_id: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, required for bookings"),
      },
      annotations: { readOnlyHint: true },
    },
    tool(({ shop, variant_id, date }) => buyer.availability(shop, variant_id, date)),
  );

  server.registerTool(
    "shop_create_order",
    {
      description: `Place an order after the user has confirmed the summary. A booking takes exactly one item and needs slot_start; shipping needs an address; bookings and shipping items can't be mixed. Returns the order with a paymentUrl: give it to the user to pay in Alipay (the slot or stock is held for 15 minutes).${
        local ? "" : " Keep the returned accessToken: shop_get_order and shop_cancel_order need it."
      }`,
      inputSchema: {
        shop: shopRef,
        items: z
          .array(
            z.object({
              variant_id: z.string(),
              quantity: z.number().int().positive().optional(),
              options: z.record(z.string(), z.string()).optional().describe("Order option values keyed by option key"),
            }),
          )
          .min(1),
        customer: z.object({ name: z.string().describe("How the shop should address the customer"), phone }),
        slot_start: z.string().optional().describe("Bookings: a slot `start` from shop_get_availability"),
        address: address.optional().describe("Shipping: delivery address"),
      },
    },
    tool(({ shop, items, customer, slot_start, address }) =>
      buyer.order(shop, {
        items: items.map((i) => ({
          variantId: i.variant_id,
          ...(i.quantity ? { quantity: i.quantity } : {}),
          ...(i.options ? { options: i.options } : {}),
        })),
        customer,
        ...(slot_start ? { slotStart: slot_start } : {}),
        ...(address ? { address } : {}),
      }),
    ),
  );

  const accessToken = local
    ? {}
    : { access_token: z.string().describe("accessToken returned by shop_create_order") };

  server.registerTool(
    "shop_get_order",
    {
      description: `Order status. With wait=true, keeps checking while it is unpaid (up to ~${Math.round(WAIT_MS / 1000)}s); call again if it is still pending_payment.`,
      inputSchema: { order_id: z.string(), wait: z.boolean().optional(), ...accessToken },
      annotations: { readOnlyHint: true },
    },
    tool((args: { order_id: string; wait?: boolean | undefined; access_token?: string }) =>
      buyer.status(args.order_id, { accessToken: args.access_token, waitMs: args.wait ? WAIT_MS : 0 }),
    ),
  );

  server.registerTool(
    "shop_cancel_order",
    {
      description:
        "Cancel an order. Unpaid orders always cancel. Paid bookings cancel with an automatic refund only before the shop's free-cancellation window; later, or once shipped, the user must contact the shop. Confirm with the user first.",
      inputSchema: { order_id: z.string(), ...accessToken },
    },
    tool((args: { order_id: string; access_token?: string }) => buyer.cancel(args.order_id, args.access_token)),
  );

  const store = buyer.store;
  if (store) {
    server.registerTool(
      "shop_list_orders",
      { description: "Orders placed from this computer, newest first, with current status.", annotations: { readOnlyHint: true } },
      tool(() => buyer.myOrders()),
    );

    server.registerTool(
      "profile_get",
      {
        description: "The user's saved name, phone and delivery addresses, kept only on this computer. Empty if nothing is saved yet.",
        annotations: { readOnlyHint: true },
      },
      tool(() => store.profile()),
    );

    server.registerTool(
      "profile_save",
      {
        description: "Save the user's name, phone and/or addresses on this computer for future orders. Only call after the user agrees. Fields you omit stay as they are; addresses replaces the whole list.",
        inputSchema: { name: z.string().optional(), phone: phone.optional(), addresses: z.array(address).optional() },
      },
      tool(async (patch: { name?: string | undefined; phone?: string | undefined; addresses?: z.infer<typeof address>[] | undefined }) => {
        const next = { ...(await store.profile()) };
        if (patch.name !== undefined) next.name = patch.name;
        if (patch.phone !== undefined) next.phone = patch.phone;
        if (patch.addresses !== undefined) next.addresses = patch.addresses;
        await store.saveProfile(next);
        return next;
      }),
    );
  }

  return server;
}
