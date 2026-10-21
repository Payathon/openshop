import { parseArgs } from "node:util";
import { Buyer, type OrderInput, type Profile } from "@openshop/client/buyer";
import { serveMcp } from "./mcp.ts";
import { fileStore, openshopHome } from "./store.ts";

export const VERSION = "0.1.0";

const HELP = `openshop — browse OpenShop stores, book or buy, and follow your orders

Shops (<shop> is a share link like https://…/s/nail-studio, or a slug)
  openshop shop <shop>                          shop info, hours and all products
  openshop products <shop> [--query <kw>]       products, optionally filtered
  openshop product <shop> <productId>
  openshop slots <shop> <variantId> --date YYYY-MM-DD
                                                free booking slots (or stock, for shipping)

Orders
  openshop order <shop> --input '<json>'        place an order; prints the payment link
      {"items":[{"variantId":"…","options":{"color":"裸粉"}}],
       "customer":{"name":"王小姐","phone":"13700000000"},
       "slotStart":"2026-10-17T14:00:00+08:00"}          bookings
       …or "address":{"recipient","phone","region","detail"} for shipping
  openshop status <orderId> [--wait]            --wait keeps checking while unpaid (~90s)
  openshop cancel <orderId>
  openshop orders                               orders placed from this computer

Profile (kept in ${openshopHome()})
  openshop profile                              saved name, phone, addresses
  openshop profile --set '<json>'               merge {"name","phone","addresses"}

  openshop mcp                                  the same tools as an MCP server (stdio)

Options: --server <url> (or OPENSHOP_SERVER) for bare slugs, --token <t> for orders
not placed from this computer. Output is JSON.`;

const STATUS_WAIT_MS = Number(process.env.OPENSHOP_STATUS_WAIT_MS ?? 90_000);

export async function main(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      server: { type: "string" },
      query: { type: "string" },
      date: { type: "string" },
      input: { type: "string" },
      set: { type: "string" },
      token: { type: "string" },
      wait: { type: "boolean" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.version) return console.log(VERSION);
  const [cmd, a, b] = positionals;
  if (!cmd || values.help) return console.log(HELP);

  const server = values.server ?? process.env.OPENSHOP_SERVER ?? "http://localhost:8788";
  if (cmd === "mcp") return serveMcp(server);

  const store = fileStore();
  const buyer = new Buyer({ server, store });
  const need = (v: string | undefined, what: string) => {
    if (!v) throw new Error(`用法：openshop ${cmd} <${what}>，见 openshop --help`);
    return v;
  };
  const parse = <T>(raw: string | undefined, flag: string): T => {
    try {
      return JSON.parse(need(raw, `--${flag} '<json>'`)) as T;
    } catch (err) {
      throw new Error(`--${flag} 不是有效的 JSON：${(err as Error).message}`);
    }
  };
  const print = (o: unknown) => console.log(JSON.stringify(o, null, 2));

  switch (cmd) {
    case "shop":
      return print(await buyer.open(need(a, "shop")));
    case "products":
      return print(await buyer.products(need(a, "shop"), values.query));
    case "product":
      return print(await buyer.product(need(a, "shop"), need(b, "productId")));
    case "slots":
      return print(await buyer.availability(need(a, "shop"), need(b, "variantId"), values.date));
    case "order":
      return print(await buyer.order(need(a, "shop"), parse<OrderInput>(values.input, "input")));
    case "status":
      return print(await buyer.status(need(a, "orderId"), { accessToken: values.token, waitMs: values.wait ? STATUS_WAIT_MS : 0 }));
    case "cancel":
      return print(await buyer.cancel(need(a, "orderId"), values.token));
    case "orders":
      return print(await buyer.myOrders());
    case "profile": {
      if (values.set === undefined) return print(await store.profile());
      const patch = parse<Profile>(values.set, "set");
      const next = { ...(await store.profile()), ...patch };
      await store.saveProfile(next);
      return print(next);
    }
    default:
      throw new Error(`未知命令 ${cmd}，见 openshop --help`);
  }
}
