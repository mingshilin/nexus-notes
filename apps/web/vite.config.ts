import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react-dom") || id.includes(`${path.sep}react${path.sep}`)) return "react-vendor";
          if (id.includes("react-markdown") || id.includes("remark-gfm")) return "markdown-vendor";
          if (id.includes("tesseract.js") || id.includes("pdfjs-dist")) return "ocr-vendor";
          if (id.includes("@radix-ui")) return "radix-vendor";
          if (id.includes("lucide-react") || id.includes("framer-motion")) return "ui-vendor";
          if (id.includes("sonner") || id.includes("zustand")) return "app-vendor";
        },
      },
    },
  },
});
