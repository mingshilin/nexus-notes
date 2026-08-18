import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "@/App";
import "@/styles/globals.css";
import { AppErrorBoundary } from "@/components/error/AppErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <Toaster
      position="top-right"
      richColors
      toastOptions={{
        classNames: {
          toast: "surface-card nexus-toast",
          success: "nexus-toast-success",
          error: "nexus-toast-failure",
          warning: "nexus-toast-warning",
          info: "nexus-toast-info",
        },
      }}
    />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
