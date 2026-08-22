import type { HTMLAttributes } from "react";

export function PageScrollArea({ className, scrollOwner = true, ...props }: HTMLAttributes<HTMLDivElement> & { scrollOwner?: boolean }) {
  const classes = ["page-scroll-area", className].filter(Boolean).join(" ");
  return <div {...props} className={classes} data-scroll-owner={scrollOwner ? "page" : undefined} style={{ ...props.style, ...(scrollOwner ? { overflowY: "auto" } : {}) }} />;
}
