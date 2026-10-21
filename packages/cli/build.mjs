import { build } from "esbuild";

// OPENSHOP_DEFAULT_SERVER=https://openshop.example pnpm build — the server bare slugs go to
// in the published CLI. Without it the bundle defaults to http://localhost:8788.
const defaultServer = process.env.OPENSHOP_DEFAULT_SERVER;
if (defaultServer && !/^https?:\/\/[^/]+$/.test(defaultServer)) {
  throw new Error(`OPENSHOP_DEFAULT_SERVER must be an origin like https://openshop.example, got ${defaultServer}`);
}

await build({
  entryPoints: ["src/bin.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/openshop.mjs",
  banner: { js: "#!/usr/bin/env node" },
  define: defaultServer ? { OPENSHOP_DEFAULT_SERVER: JSON.stringify(defaultServer) } : {},
});
