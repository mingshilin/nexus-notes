import { createElement, type ComponentPropsWithoutRef, type ElementType } from "react";

export type SurfaceVariant = "window" | "sidebar" | "list" | "editor" | "panel" | "overlay";

export type SurfaceProps<T extends ElementType = "div"> = {
  as?: T;
  variant: SurfaceVariant;
} & Omit<ComponentPropsWithoutRef<T>, "as">;

export function Surface<T extends ElementType = "div">({
  as,
  variant,
  className,
  ...props
}: SurfaceProps<T>) {
  const element = as ?? "div";
  const classes = ["nexus-surface", `nexus-surface-${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return createElement(element, {
    ...props,
    className: classes,
    "data-surface": variant,
  });
}
