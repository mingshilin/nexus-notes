import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { registerBetaServiceWorker } from "./data/service-worker";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) {
  void registerBetaServiceWorker({
    onUpdate: (update) => {
      window.dispatchEvent(new CustomEvent("nexus:service-worker-update", { detail: update }));
    },
  });
}
