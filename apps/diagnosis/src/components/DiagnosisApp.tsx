"use client";

import { useEffect, useRef, useState } from "react";
import type { DiagnosisResponse } from "@/lib/diagnosis/types";
import { DiagnosisForm, StepIndicator } from "./DiagnosisForm";
import {
  STEPS,
  initialFormState,
  toDiagnosisInput,
  validateStep,
  type FormState,
} from "./form-state";
import { ResultView } from "./ResultView";

type Phase =
  | { kind: "form"; step: number }
  | { kind: "loading" }
  | { kind: "result"; data: DiagnosisResponse };

export function DiagnosisApp() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [phase, setPhase] = useState<Phase>({ kind: "form", step: 0 });
  const [error, setError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // ステップを移動したら、新しいステップの最初の入力欄にフォーカスを移す
  // (押したボタンが消えるとフォーカスが失われ、キーボード操作では元の位置に戻れないため)
  const focusFirstField = useRef(false);

  useEffect(() => {
    if (phase.kind !== "form" || !focusFirstField.current) return;
    focusFirstField.current = false;
    formRef.current
      ?.querySelector<HTMLElement>("input, select, textarea")
      ?.focus({ preventScroll: true });
  }, [phase]);

  const scrollToTop = () =>
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const goToStep = (step: number) => {
    setError(null);
    focusFirstField.current = true;
    setPhase({ kind: "form", step });
    scrollToTop();
  };

  const submit = async () => {
    setPhase({ kind: "loading" });
    scrollToTop();
    let message = "通信エラーが発生しました。もう一度お試しください。";
    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toDiagnosisInput(form)),
      });
      // タイムアウト時などはJSONでないエラーページが返るので、解析エラーをそのまま見せない
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        setPhase({ kind: "result", data: body as DiagnosisResponse });
        return;
      }
      message = body?.error ?? "診断に失敗しました。時間をおいてもう一度お試しください。";
    } catch {
      // fetch自体の失敗(オフラインなど)は上の通信エラーの文言を出す
    }
    setError(message);
    focusFirstField.current = true;
    setPhase({ kind: "form", step: STEPS.length - 1 });
  };

  const next = (step: number) => {
    const message = validateStep(step, form);
    if (message) {
      setError(message);
      return;
    }
    if (step < STEPS.length - 1) goToStep(step + 1);
    else void submit();
  };

  return (
    <div ref={topRef} className="scroll-mt-6">
      {phase.kind === "result" && (
        <ResultView
          data={phase.data}
          companyName={form.companyName.trim() || undefined}
          onRestart={() => goToStep(0)}
        />
      )}

      {phase.kind === "loading" && (
        <div
          role="status"
          className="flex flex-col items-center gap-4 rounded-xl border border-line bg-surface px-6 py-16 text-center"
        >
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-track border-t-accent" />
          <p className="font-semibold">診断レポートを作成しています</p>
          <p className="text-sm text-muted">
            AIが回答内容を分析しています。30秒〜1分ほどお待ちください。
          </p>
        </div>
      )}

      {phase.kind === "form" && (
        <form
          ref={formRef}
          className="space-y-8 rounded-xl border border-line bg-surface p-6 sm:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            next(phase.step);
          }}
          noValidate
        >
          <StepIndicator step={phase.step} />
          <DiagnosisForm step={phase.step} form={form} onChange={setForm} />

          {error && (
            <p role="alert" className="text-sm font-medium text-critical">
              {error}
            </p>
          )}

          <div className="flex justify-between gap-3">
            {phase.step > 0 ? (
              <button
                type="button"
                onClick={() => goToStep(phase.step - 1)}
                className="rounded-md border border-line px-4 py-2 font-medium hover:bg-surface-2"
              >
                戻る
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              className="rounded-md bg-accent-strong px-6 py-2.5 font-semibold text-white hover:opacity-90"
            >
              {phase.step < STEPS.length - 1 ? "次へ" : "診断する"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
