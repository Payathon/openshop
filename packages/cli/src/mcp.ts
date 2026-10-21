import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Buyer } from "@openshop/client/buyer";
import { createMcpServer as createServer } from "@openshop/client/mcp";
import { fileStore } from "./store.ts";

// `openshop mcp`: the storefront tools over stdio, with the customer's profile and order
// records from ~/.openshop. `server` is only used for bare slugs; share links carry their own host.
export function createMcpServer(server: string) {
  return createServer(new Buyer({ server, store: fileStore() }));
}

export async function serveMcp(server: string) {
  await createMcpServer(server).connect(new StdioServerTransport());
}
