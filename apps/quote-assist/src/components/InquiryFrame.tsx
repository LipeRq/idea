import Link from "next/link";
import type { ReactNode } from "react";
import { INQUIRY_STATUS_LABEL, type Inquiry } from "@/lib/domain/inquiry";
import { formatDuration, formatYen } from "@/lib/format";
import { summarizeMetrics } from "@/lib/views";

export type StepKey = "extraction" | "similar" | "quote" | "document" | "crm";

const STEPS: { key: StepKey; label: string; path: string }[] = [
  { key: "extraction", label: "抽出結果・確認事項", path: "" },
  { key: "similar", label: "類似案件", path: "/similar" },
  { key: "quote", label: "見積根拠・修正", path: "/quote" },
  { key: "document", label: "見積書・回答メール", path: "/document" },
  { key: "crm", label: "Salesforce登録", path: "/crm" },
];

function enabled(key: StepKey, inquiry: Inquiry): boolean {
  if (key === "similar") return inquiry.similar !== null;
  if (key === "quote" || key === "document") return inquiry.quote !== null;
  return true;
}

/** 引き合いの各画面に共通の見出しとステップ表示 */
export function InquiryFrame({ inquiry, step, children }: { inquiry: Inquiry; step: StepKey; children: ReactNode }) {
  const spec = inquiry.extraction.spec;
  const metrics = summarizeMetrics(inquiry);
  const title = [spec.partName ?? "品名未確定", spec.drawingNumber && `${spec.drawingNumber}${spec.revision ? ` Rev.${spec.revision}` : ""}`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-6">
      <header className="no-print space-y-3">
        <p className="text-sm text-muted">
          <Link href="/" className="hover:underline">
            見積待ち一覧
          </Link>{" "}
          / 引き合い
        </p>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-bold break-words">{title}</h1>
          <span className="text-ink-2">{spec.customerName ?? "顧客未確定"}</span>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2" data-testid="inquiry-status">
            {INQUIRY_STATUS_LABEL[inquiry.status]}
          </span>
        </div>
        <p className="text-xs text-muted">
          処理時間 {formatDuration(metrics.totalMs)}
          {metrics.usedAi
            ? `・AI ${metrics.inputTokens.toLocaleString("ja-JP")}/${metrics.outputTokens.toLocaleString("ja-JP")}トークン(入力/出力)・概算 ${formatYen(metrics.costJpy)}`
            : "・AI未使用(デモモード)"}
        </p>
        <nav aria-label="見積の手順">
          <ol className="flex flex-wrap gap-2 text-sm">
            {STEPS.map((s, i) => {
              const label = `${i + 1}. ${s.label}`;
              if (s.key === step) {
                return (
                  <li key={s.key} aria-current="step" className="rounded-full bg-accent-strong px-3 py-1 font-semibold text-white">
                    {label}
                  </li>
                );
              }
              return (
                <li key={s.key}>
                  {enabled(s.key, inquiry) ? (
                    <Link href={`/inquiries/${inquiry.id}${s.path}`} className="block rounded-full border border-line px-3 py-1 text-ink-2 hover:bg-surface-2">
                      {label}
                    </Link>
                  ) : (
                    <span className="block rounded-full border border-dashed border-line px-3 py-1 text-muted">{label}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </header>
      {children}
    </div>
  );
}
