import { useEffect } from "react";
import { useAppStore } from "@/store/useAppStore";

function resolveTheme(theme: "light" | "dark" | "system"): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function useTheme() {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    const applied = resolveTheme(theme);
    root.classList.toggle("dark", applied === "dark");
    root.dataset.theme = applied;
  }, [theme]);
}
