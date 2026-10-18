"use client";

import { useState } from "react";
import type { DiagnosisInput } from "@/lib/diagnosis/schema";
import type { DiagnosisResponse } from "@/lib/diagnosis/types";
import { fileNameFromDisposition } from "@/lib/report/file-name";

type Props = {
  data: DiagnosisResponse;
  input: DiagnosisInput;
  onRestart: () => void;
};

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const secondaryButton =
  "rounded-md border border-line bg-surface px-4 py-2 font-medium hover:bg-surface-2";

export function ReportActions({ data, input, onRestart }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const loading = status.kind === "loading";

  const download = async () => {
    if (loading) return;
    setStatus({ kind: "loading" });
    try {
      // 数値はサーバーが入力から計算し直す。AIの文章は署名と一緒に送り、一致したときだけ使われる
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          ...(data.aiGenerated ? { report: data.report, reportToken: data.reportToken } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setStatus({
          kind: "error",
          message: body?.error ?? "PDFの作成に失敗しました。時間をおいてもう一度お試しください。",
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        fileNameFromDisposition(res.headers.get("content-disposition")) ?? "AI導入診断レポート.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      // すぐに解放するとダウンロードが始まらないブラウザがある
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus({ kind: "done" });
    } catch {
      setStatus({ kind: "error", message: "通信エラーが発生しました。もう一度お試しください。" });
    }
  };

  return (
    <div className="no-print space-y-2">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={download}
          // disabled にするとフォーカスが外れるので、作成中は aria-disabled で押せないことだけ伝える
          aria-disabled={loading || undefined}
          className="rounded-md bg-accent-strong px-5 py-2 font-semibold text-white hover:opacity-90 aria-disabled:cursor-wait aria-disabled:opacity-70"
        >
          {loading ? "PDFを作成しています…" : "PDFをダウンロード"}
        </button>
        <button type="button" onClick={() => window.print()} className={secondaryButton}>
          印刷する
        </button>
        <button type="button" onClick={onRestart} className={secondaryButton}>
          入力内容を修正して再診断
        </button>
      </div>
      <p role="status" className="text-sm text-ink-2">
        {status.kind === "done" ? "PDFをダウンロードしました。" : ""}
      </p>
      {status.kind === "error" && (
        <p role="alert" className="text-sm font-medium text-critical">
          {status.message}
        </p>
      )}
    </div>
  );
}
