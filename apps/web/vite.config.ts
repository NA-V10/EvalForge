import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const KEY_FILE = resolve(__dirname, "../../.data/dev-api-key");
/** Read lazily: the API creates the key on first start, possibly after Vite boots. */
const devKey = () => process.env.RELIABILITY_API_KEY ?? (existsSync(KEY_FILE) ? readFileSync(KEY_FILE, "utf8").trim() : "");

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes("@codemirror") || id.includes("@lezer") || id.includes("@uiw") ? "editor" : id.includes("node_modules") ? "vendor" : undefined,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://localhost:4000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (req) => {
            if (!req.getHeader("x-api-key")) req.setHeader("x-api-key", devKey());
          });
        },
      },
    },
  },
});
