import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The merchant workbench lives under /admin on the same origin as the shops and the API.
// In dev the API runs separately (apps/server, port 8788); everything outside /admin is proxied to it.
const api = process.env.OPENSHOP_API ?? "http://localhost:8788";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: {
    host: true,
    proxy: Object.fromEntries(["/api", "/s", "/files", "/dev", "/mcp", "/healthz"].map((p) => [p, api])),
  },
});
