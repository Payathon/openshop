import { ApiError } from "@openshop/client/api";
import { main } from "./main.ts";

main(process.argv.slice(2)).catch((err: unknown) => {
  const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message;
  console.error(`error: ${msg}`);
  process.exit(1);
});
