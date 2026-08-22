import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3100,
    proxy: {
      "/api/v2": "http://127.0.0.1:8788",
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 500,
  },
});
