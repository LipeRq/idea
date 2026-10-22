"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAiStatus, type AiStatus } from "@/lib/ai-client";
import { CONSENT_VERSION } from "@/lib/ai-consent";
import type { AiDocumentJson } from "@/lib/ai-json";
import { AnalysisController, AnalysisFailure, CancelledError } from "@/lib/analysis-controller";
import { ENGINE_LIMITS, RENDER_WATCHDOG_MS, WATCHDOG_MS } from "@/lib/browser-limits";
import { browserWorkerFactory } from "@/lib/engine-loader";
import type { Failure } from "@/lib/errors";
import { precheckFiles } from "@/lib/file-types";
import { warmUpMermaid } from "@/lib/mermaid-render";
import { fetchSampleFile, type SampleEntry } from "@/lib/samples";
import type { AiPayload, AnalysisResult, Phase } from "@/worker/protocol";
import { AiConsentDialog } from "./AiConsentDialog";
import { AnalyzingView } from "./AnalyzingView";
import { ErrorView } from "./ErrorView";
import { FilePicker } from "./FilePicker";
import { PrivacyBadge } from "./PrivacyBadge";
import { ResultView } from "./result/ResultView";
import type { AiResult } from "./result/types";
import { SampleList } from "./SampleList";
import { Notice } from "./ui";

type View =
  | { kind: "select"; notice?: string }
  | { kind: "analyzing"; fileName: string; phase: Phase | "waiting"; startedAt: number }
  | { kind: "error"; fileName: string; failure: Failure }
  | { kind: "result"; fileName: string; result: AnalysisResult; ai: AiResult | null };

const onIdle = (fn: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 200);
};

/**
 * ツール本体(選択 → 解析中 → 結果)。解析の状態はメモリ上の React の状態だけに持ち、
 * URL・localStorage・IndexedDB・Cookie には何も保存しない(タブを閉じると消える)。
 */
export function InventoryApp({
  samples,
  workerUrl,
  contactUrl,
  privacyUrl,
  termsUrl,
  operatorName,
}: {
  samples: SampleEntry[];
  workerUrl: string;
  contactUrl: string | null;
  privacyUrl: string | null;
  termsUrl: string | null;
  operatorName: string | null;
}) {
  const [view, setView] = useState<View>({ kind: "select" });
  const [tab, setTab] = useState("overview");
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [diagramReady, setDiagramReady] = useState(false);
  const [cspViolations, setCspViolations] = useState(0);
  const controllerRef = useRef<AnalysisController | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    const controller = new AnalysisController({
      createWorker: browserWorkerFactory(workerUrl),
      watchdogMs: WATCHDOG_MS,
      renderWatchdogMs: RENDER_WATCHDOG_MS,
      onCspViolation: () => setCspViolations((c) => c + 1),
    });
    controllerRef.current = controller;
    // ページを開いた後のアイドル時に、解析プログラムと図の描画に必要なものを読み込んでおく(オフラインでも動くように)
    onIdle(() => {
      controller.warmUp().then(
        () => setEngineReady(true),
        () => setEngineReady(false),
      );
      warmUpMermaid().then(setDiagramReady, () => setDiagramReady(false));
    });
    // AI 版の利用可否(ファイル由来の情報を含まない GET)。使えない環境ではボタンを出さない
    const abort = new AbortController();
    fetchAiStatus(abort.signal).then((s) => setAiStatus(s));
    return () => {
      abort.abort();
      controller.dispose();
      controllerRef.current = null;
    };
  }, [workerUrl]);

  const analyze = useCallback(async (files: File[]) => {
    const controller = controllerRef.current;
    if (!controller || controller.busy) return;
    const check = precheckFiles(files);
    if (!check) return;
    if (!check.ok) {
      setView({ kind: "select", notice: check.message });
      return;
    }
    const file = check.file;
    setView({ kind: "analyzing", fileName: file.name, phase: "waiting", startedAt: Date.now() });
    try {
      const result = await controller.analyze(file, ENGINE_LIMITS, (phase) =>
        setView((v) => (v.kind === "analyzing" ? { ...v, phase } : v)),
      );
      setTab("overview");
      setView({ kind: "result", fileName: file.name, result, ai: null });
    } catch (e) {
      if (e instanceof CancelledError) setView({ kind: "select" });
      else setView({ kind: "error", fileName: file.name, failure: e instanceof AnalysisFailure ? e.failure : { code: "internal" } });
    }
  }, []);

  const trySample = useCallback(
    async (sample: SampleEntry) => {
      let file: File;
      try {
        file = await fetchSampleFile(sample);
      } catch {
        setView({ kind: "select", notice: "サンプルを読み込めませんでした。ネットワークの接続を確認して、もう一度お試しください。" });
        return;
      }
      await analyze([file]);
    },
    [analyze],
  );

  // ドロップゾーンの外にファイルを落としても、ブラウザがファイルを開いて結果が消えないようにする。
  // 選択画面では、ページのどこに落としても解析する
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      if (viewRef.current.kind === "select" && e.dataTransfer.files.length > 0) void analyze(Array.from(e.dataTransfer.files));
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", drop);
    };
  }, [analyze]);

  // 結果があるときは、再読み込み・ページを閉じる・同じタブでの画面の移動の前に確認する(結果はメモリにしかないため)
  useEffect(() => {
    if (view.kind !== "result") return;
    const confirmUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // ヘッダーの「仕組みとデータの扱い」など、同じタブで開くサイト内のリンク(クライアント側の移動は beforeunload が出ない)
    const confirmLink = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || a.hasAttribute("download")) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (new URL(a.href, location.href).origin !== location.origin) return;
      if (!window.confirm("このページを移動すると、いまの解析結果は消えます。よろしいですか?(必要なら先に保存してください)")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", confirmUnload);
    document.addEventListener("click", confirmLink, true);
    return () => {
      window.removeEventListener("beforeunload", confirmUnload);
      document.removeEventListener("click", confirmLink, true);
    };
  }, [view.kind]);

  const onGenerated = useCallback(async (json: AiDocumentJson) => {
    const controller = controllerRef.current;
    const current = viewRef.current;
    if (!controller || current.kind !== "result") return;
    const rendered = await controller.render(current.result.report, json);
    setView((v) => (v.kind === "result" && v.result === current.result ? { ...v, ai: { json, ...rendered, mock: aiStatus?.mode === "mock" } } : v));
    setAiOpen(false);
    setTab("ai");
  }, [aiStatus]);

  const resultReport = view.kind === "result" ? view.result.report : null;
  const buildAiPayload = useCallback(
    (includeSource: boolean): Promise<AiPayload> => {
      const controller = controllerRef.current;
      if (!controller || !resultReport) return Promise.reject(new CancelledError());
      return controller.buildAiPayload(resultReport, includeSource, CONSENT_VERSION);
    },
    [resultReport],
  );

  const backToSelect = () => setView({ kind: "select" });

  return (
    <main
      data-engine-ready={engineReady ? "true" : "false"}
      data-diagram-ready={diagramReady ? "true" : "false"}
      data-csp-violations={cspViolations}
      data-view={view.kind}
    >
      {view.kind === "select" && (
        <>
          <section aria-labelledby="hero-heading">
            <h1 id="hero-heading" className="text-2xl font-bold sm:text-3xl">
              辞めた人が作ったマクロ、中身を見える化します
            </h1>
            <p className="mt-2 max-w-3xl text-ink-2">
              Excel マクロ・Access ファイルを読み込むと、マクロの一覧・処理の流れ・外部とのつながり・リスク・移行の難しさの目安をまとめた仕様書を作ります。
            </p>
            <ul className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                ["ファイルはこのブラウザの外に出ません", "解析はこのパソコンのブラウザの中で行います"],
                ["無料・登録不要", "インストールも要りません"],
                ["Excel マクロ・Access に対応", ".xlsm .xlsb .xls .accdb .mdb など"],
              ].map(([title, note]) => (
                <li key={title} className="rounded-xl border border-line bg-surface p-3">
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-ink-2">{note}</p>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <PrivacyBadge />
            </div>
          </section>
          <div className="mt-6">
            {view.notice && (
              <div className="mb-3">
                <Notice level="critical" role="alert">
                  {view.notice}
                </Notice>
              </div>
            )}
            <FilePicker onFiles={(files) => void analyze(files)} />
          </div>
          <SampleList samples={samples} onSelect={(s) => void trySample(s)} />
        </>
      )}
      {view.kind === "analyzing" && (
        <AnalyzingView fileName={view.fileName} phase={view.phase} startedAt={view.startedAt} onCancel={() => controllerRef.current?.cancel()} />
      )}
      {view.kind === "error" && <ErrorView fileName={view.fileName} failure={view.failure} onBack={backToSelect} />}
      {view.kind === "result" && (
        <>
          <ResultView
            fileName={view.fileName}
            result={view.result}
            ai={view.ai}
            aiAvailable={Boolean(aiStatus?.available)}
            selectedTab={tab}
            onSelectTab={setTab}
            onOpenAi={() => setAiOpen(true)}
            onAnalyzeAnother={() => {
              if (window.confirm("いまの解析結果は消えます。よろしいですか?(必要なら先に保存してください)")) backToSelect();
            }}
          />
          {aiStatus?.available && aiOpen && (
            <AiConsentDialog
              open={aiOpen}
              onClose={() => setAiOpen(false)}
              format={view.result.report.file.format}
              fileName={view.fileName}
              status={aiStatus}
              buildPayload={buildAiPayload}
              privacyUrl={privacyUrl}
              termsUrl={termsUrl}
              operatorName={operatorName}
              contactUrl={contactUrl}
              onGenerated={onGenerated}
            />
          )}
        </>
      )}
    </main>
  );
}
