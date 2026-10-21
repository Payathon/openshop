import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LocalStore, OrderRecord, Profile } from "@openshop/client/buyer";

// Everything the CLI keeps lives in ~/.openshop (or $OPENSHOP_HOME), readable only by the user:
// profile.json holds the customer's name, phone and addresses; orders.json the access token of
// every order placed from this machine.

export const openshopHome = () => process.env.OPENSHOP_HOME ?? join(homedir(), ".openshop");

// Read on every call so the CLI and a running `openshop mcp` see each other's writes.
export function fileStore(dir = openshopHome()): LocalStore {
  const path = (name: string) => join(dir, name);

  async function read<T>(name: string, empty: T): Promise<T> {
    try {
      return JSON.parse(await readFile(path(name), "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty;
      throw new Error(`读取 ${path(name)} 失败：${(err as Error).message}`);
    }
  }

  async function write(name: string, data: unknown) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${path(name)}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, path(name));
  }

  return {
    profile: () => read<Profile>("profile.json", {}),
    saveProfile: (p) => write("profile.json", p),
    orders: () => read<OrderRecord[]>("orders.json", []),
    saveOrder: async (r) => write("orders.json", [...(await read<OrderRecord[]>("orders.json", [])), r]),
  };
}
