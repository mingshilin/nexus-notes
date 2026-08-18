import type { ReactNode } from "react";

interface DatabasePropertyManagerProps {
  children: ReactNode;
}

export function DatabasePropertyManager({ children }: DatabasePropertyManagerProps) {
  return (
    <div className="mt-4 rounded-[18px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04]">
      {children}
    </div>
  );
}
