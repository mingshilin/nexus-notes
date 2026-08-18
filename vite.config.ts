import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const devApiProxyTarget = process.env.VITE_DEV_API_PROXY ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (id.includes("react-dom") || id.includes(`${path.sep}react${path.sep}`)) {
            return "react-vendor";
          }

          if (id.includes("react-markdown") || id.includes("remark-gfm")) {
            return "markdown-vendor";
          }

          if (id.includes("tesseract.js") || id.includes("pdfjs-dist")) {
            return "ocr-vendor";
          }

          if (id.includes("@radix-ui")) {
            return "radix-vendor";
          }

          if (id.includes("lucide-react") || id.includes("framer-motion")) {
            return "ui-vendor";
          }

          if (id.includes("sonner") || id.includes("zustand")) {
            return "app-vendor";
          }
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: devApiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./tests/frontend/setup.ts",
    include: ["tests/frontend/**/*.test.ts", "tests/frontend/**/*.test.tsx"],
  },
});
