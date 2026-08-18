import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
  compact?: boolean;
}

export function BrandMark({ className, compact = false }: BrandMarkProps) {
  return (
    <div className={cn("inline-flex items-center gap-3", className)}>
      <svg
        viewBox="0 0 48 48"
        className={cn(compact ? "h-9 w-9" : "h-11 w-11")}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="nexus-notes-gradient" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0ea5e9" />
            <stop offset="0.52" stopColor="#2563eb" />
            <stop offset="1" stopColor="#14b8a6" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="40" height="40" rx="14" fill="url(#nexus-notes-gradient)" />
        <path
          d="M16 14.5h10.5l5.5 5.7v13.3c0 1.4-1.1 2.5-2.5 2.5h-13c-1.4 0-2.5-1.1-2.5-2.5v-16.5c0-1.4 1.1-2.5 2.5-2.5Z"
          fill="rgba(255,255,255,0.92)"
        />
        <path d="M26.5 14.5v4.2c0 1 .8 1.8 1.8 1.8H32" fill="rgba(255,255,255,0.72)" />
        <path d="M19 26h10" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" />
        <path d="M19 30h8" stroke="#14b8a6" strokeWidth="2" strokeLinecap="round" />
        <circle cx="34.5" cy="14" r="4.5" fill="#f8fafc" />
        <path d="M34.5 11.5v5M32 14h5" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </div>
  );
}
