import type { ReactNode } from "react";
import { CONFIDENCE_LABEL, type Confidence, type FieldStatus } from "@/lib/domain/inquiry";

// 画面共通の小さな部品

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

const CONFIDENCE_CLASS: Record<Confidence, string> = {
  high: "border-line text-ink-2",
  medium: "border-warning text-warning",
  low: "border-critical bg-critical-soft text-critical-ink",
};

export function ConfidenceBadge({ value }: { value: Confidence }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${CONFIDENCE_CLASS[value]}`}>
      確信度 {CONFIDENCE_LABEL[value]}
    </span>
  );
}

const STATUS: Record<FieldStatus, { label: string; className: string }> = {
  ok: { label: "OK", className: "bg-good-soft text-good" },
  review: { label: "要確認", className: "bg-warning-soft text-warning" },
  missing: { label: "不足", className: "bg-critical-soft text-critical-ink" },
};

export function FieldStatusBadge({ status }: { status: FieldStatus }) {
  const s = STATUS[status];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${s.className}`}>{s.label}</span>;
}

export function Notice({ level, children }: { level: "warning" | "info" | "critical"; children: ReactNode }) {
  const cls =
    level === "critical"
      ? "border-critical bg-critical-soft text-critical-ink"
      : level === "warning"
        ? "border-warning bg-warning-soft text-warning"
        : "border-line bg-surface-2 text-ink-2";
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

export function Loading({ label = "読み込んでいます" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-line bg-surface px-6 py-10 text-sm text-ink-2">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-track border-t-accent" />
      {label}
    </div>
  );
}

export const buttonPrimary =
  "inline-flex items-center justify-center rounded-md bg-accent-strong px-5 py-2.5 font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center rounded-md border border-line-strong px-4 py-2 font-medium hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
export const inputClass =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-ink focus:outline-2 focus:outline-accent";
