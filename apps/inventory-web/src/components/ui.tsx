import type { ReactNode } from "react";

// 画面共通の小さな部品(apps/quote-assist の src/components/ui.tsx と同じトークン・見た目)

export function Card({ children, className = "", labelledBy }: { children: ReactNode; className?: string; labelledBy?: string }) {
  return (
    <section aria-labelledby={labelledBy} className={`rounded-xl border border-line bg-surface p-4 sm:p-6 ${className}`}>
      {children}
    </section>
  );
}

export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

export function Notice({ level, children, role }: { level: "warning" | "info" | "critical"; children: ReactNode; role?: "alert" | "status" }) {
  const cls =
    level === "critical"
      ? "border-critical bg-critical-soft text-critical-ink"
      : level === "warning"
        ? "border-warning bg-warning-soft text-warning"
        : "border-line bg-surface-2 text-ink-2";
  return (
    <div role={role} className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

const SEVERITY_CLASS = {
  high: "bg-critical-soft text-critical-ink border-critical",
  medium: "bg-warning-soft text-warning border-warning",
  low: "bg-surface-2 text-ink-2 border-line-strong",
} as const;

export function SeverityBadge({ severity, label }: { severity: "high" | "medium" | "low"; label: string }) {
  return (
    <span className={`inline-block shrink-0 rounded border px-2 py-0.5 text-xs font-semibold ${SEVERITY_CLASS[severity]}`}>
      重要度 {label}
    </span>
  );
}

export const buttonPrimary =
  "inline-flex items-center justify-center rounded-md bg-accent-strong px-5 py-2.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center rounded-md border border-line-strong px-4 py-2 font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonLink = "text-accent-ink underline underline-offset-2 hover:opacity-80";
export const inputClass =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-ink focus:outline-2 focus:outline-accent";
