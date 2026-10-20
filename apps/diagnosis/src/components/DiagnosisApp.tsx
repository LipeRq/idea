"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import type { DiagnosisInput } from "@/lib/diagnosis/schema";
import type { DiagnosisResponse } from "@/lib/diagnosis/types";
import { DiagnosisForm, FORM_ERROR_ID, StepIndicator } from "./DiagnosisForm";
import {
  STEPS,
  initialFormState,
  toDiagnosisInput,
  validateStep,
  type FormState,
  type StepError,
} from "./form-state";
import { ResultView } from "./ResultView";
import {
  TURNSTILE_PENDING_MESSAGE,
  TURNSTILE_SITE_KEY,
  TurnstileWidget,
} from "./TurnstileWidget";

type Phase =
  | { kind: "form"; step: number }
  | { kind: "loading" }
  // PDFや申し込みでは、画面の結果ではなく診断に使った入力を送ってサーバーで計算し直す
  | { kind: "result"; data: DiagnosisResponse; input: DiagnosisInput };

export function DiagnosisApp() {
  const [form, setForm] = useState<FormState>(initialFormState);
  const [phase, setPhase] = useState<Phase>({ kind: "form", step: 0 });
  const [error, setError] = useState<StepError | null>(null);
  // ボット対策(Turnstile)のトークン。無効なときは使わない
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // ステップを移動したら、新しいステップの最初の入力欄にフォーカスを移す
  // (押したボタンが消えるとフォーカスが失われ、キーボード操作では元の位置に戻れないため)
  const focusFirstField = useRef(false);
  // 計測:開始と各ステップへの到達は、ページを開くたびに1回だけ送る
  const started = useRef(false);
  const furthestStep = useRef(0);

  useEffect(() => {
    if (phase.kind !== "form" || !focusFirstField.current) return;
    focusFirstField.current = false;
    formRef.current
      ?.querySelector<HTMLElement>("input, select, textarea")
      ?.focus({ preventScroll: true });
  }, [phase]);

  const scrollToTop = () =>
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const changeForm = (update: (prev: FormState) => FormState) => {
    if (!started.current) {
      started.current = true;
      track({ name: "diagnosis_start" });
    }
    setForm(update);
  };

  const goToStep = (step: number) => {
    if (step > furthestStep.current) {
      furthestStep.current = step;
      track({ name: "diagnosis_step", step: step + 1, stepName: STEPS[step] });
    }
    setError(null);
    focusFirstField.current = true;
    setPhase({ kind: "form", step });
    scrollToTop();
  };

  const submit = async () => {
    setPhase({ kind: "loading" });
    scrollToTop();
    let message = "通信エラーが発生しました。もう一度お試しください。";
    const input = toDiagnosisInput(form);
    // トークンは1回しか使えない。失敗して入力画面に戻ったら、新しいウィジェットで取り直す
    const token = turnstileToken;
    setTurnstileToken(null);
    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "X-Turnstile-Token": token } : {}),
        },
        body: JSON.stringify(input),
      });
      // タイムアウト時などはJSONでないエラーページが返るので、解析エラーをそのまま見せない
      const body = await res.json().catch(() => null);
      if (res.ok && body) {
        const data = body as DiagnosisResponse;
        setPhase({ kind: "result", data, input });
        track({ name: "diagnosis_complete", aiGenerated: data.aiGenerated });
        return;
      }
      message = body?.error ?? "診断に失敗しました。時間をおいてもう一度お試しください。";
    } catch {
      // fetch自体の失敗(オフラインなど)は上の通信エラーの文言を出す
    }
    setError({ message, fields: [] });
    focusFirstField.current = true;
    setPhase({ kind: "form", step: STEPS.length - 1 });
  };

  const next = (step: number) => {
    const stepError = validateStep(step, form);
    if (stepError) {
      setError(stepError);
      return;
    }
    if (step < STEPS.length - 1) {
      goToStep(step + 1);
    } else if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setError({ message: TURNSTILE_PENDING_MESSAGE, fields: [] });
    } else {
      void submit();
    }
  };

  return (
    <div ref={topRef} className="scroll-mt-6">
      {phase.kind === "result" && (
        <ResultView
          data={phase.data}
          input={phase.input}
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
          <DiagnosisForm
            step={phase.step}
            form={form}
            onChange={changeForm}
            invalid={new Set(error?.fields)}
          />

          {phase.step === STEPS.length - 1 && (
            <TurnstileWidget action="diagnose" onTokenChange={setTurnstileToken} />
          )}

          {error && (
            <p id={FORM_ERROR_ID} role="alert" className="text-sm font-medium text-critical">
              {error.message}
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
