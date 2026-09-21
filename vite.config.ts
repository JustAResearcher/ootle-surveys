import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
export default defineConfig({
  plugins: [react(), wasm()],
  build: { target: "esnext" },
  server: {
    port: 5182,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4182" },
  },
});
