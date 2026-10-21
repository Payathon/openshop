import { build } from "esbuild";

await build({
  entryPoints: ["src/bin.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/openshop.mjs",
  banner: { js: "#!/usr/bin/env node" },
});
