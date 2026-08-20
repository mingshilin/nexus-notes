import type { HTMLAttributes } from "react";

export function PageScrollArea({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const classes = ["page-scroll-area", className].filter(Boolean).join(" ");
  return <div {...props} className={classes} data-scroll-owner="page" />;
}
