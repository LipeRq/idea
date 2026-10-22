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
import { type InventoryItem } from "@/lib/inventory-list";
import { warmUpMermaid } from "@/lib/mermaid-render";
import { serialMemo } from "@/lib/serial-memo";
import { fetchSampleFile, type SampleEntry } from "@/lib/samples";
import type { AiPayload, Phase } from "@/worker/protocol";
import { AiConsentDialog } from "./AiConsentDialog";
import { AnalyzingView } from "./AnalyzingView";
import { ErrorView } from "./ErrorView";
import { FilePicker } from "./FilePicker";
import { PrivacyBadge } from "./PrivacyBadge";
import { InventoryListView } from "./result/InventoryListView";
import { ResultView } from "./result/ResultView";
import type { AiResult } from "./result/types";
import { SampleList } from "./SampleList";
import { Notice } from "./ui";

type View =
  | { kind: "select"; notice?: string }
  | { kind: "analyzing"; fileName: string; phase: Phase | "waiting"; startedAt: number; index: number; total: number }
  | { kind: "error"; fileName: string; failure: Failure }
  /** items が1件なら、そのファイルの結果をそのまま表示。複数なら棚卸し一覧(selectedId のファイルを選ぶとその詳細) */
  | { kind: "result"; items: InventoryItem[]; selectedId: string | null };

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
  diagnosisUrl,
  privacyUrl,
  termsUrl,
  operatorName,
}: {
  samples: SampleEntry[];
  workerUrl: string;
  contactUrl: string | null;
  diagnosisUrl: string | null;
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
  const cancelledRef = useRef(false);
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

  /** 選ばれたファイル(最大10件)を、1件ずつ順番に解析する。1件が失敗しても、残りは続ける */
  const analyze = useCallback(async (files: File[]) => {
    const controller = controllerRef.current;
    if (!controller || controller.busy) return;
    const check = precheckFiles(files);
    if (!check) return;
    if (!check.ok) {
      setView({ kind: "select", notice: check.message });
      return;
    }
    const total = check.entries.filter((e) => e.problem === null).length;
    cancelledRef.current = false;
    const items: InventoryItem[] = [];
    let index = 0;
    let cancelled = false;
    for (const [i, { file, problem }] of check.entries.entries()) {
      const id = `file-${i + 1}`;
      if (problem !== null) {
        items.push({ id, fileName: file.name, outcome: "skipped", reason: problem });
        continue;
      }
      if (cancelledRef.current) {
        cancelled = true;
        break;
      }
      index++;
      setView({ kind: "analyzing", fileName: file.name, phase: "waiting", startedAt: Date.now(), index, total });
      try {
        const result = await controller.analyze(file, ENGINE_LIMITS, (phase) => setView((v) => (v.kind === "analyzing" ? { ...v, phase } : v)));
        items.push({ id, fileName: file.name, outcome: "done", result, ai: null });
      } catch (e) {
        if (e instanceof CancelledError) {
          cancelled = true;
          break;
        }
        items.push({ id, fileName: file.name, outcome: "failed", failure: e instanceof AnalysisFailure ? e.failure : { code: "internal" } });
      }
    }
    // 中止したときは、終わった分だけ残す(1件も終わっていなければ選択画面に戻る)
    if (cancelled && !items.some((i) => i.outcome === "done")) {
      setView({ kind: "select" });
      return;
    }
    if (items.length === 1 && items[0].outcome === "failed") {
      setView({ kind: "error", fileName: items[0].fileName, failure: items[0].failure });
      return;
    }
    setTab("overview");
    setView({ kind: "result", items, selectedId: null });
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

  // いま詳細を見ているファイル(1件だけの解析なら、そのファイル)
  const currentItem =
    view.kind === "result" ? (view.items.length === 1 ? view.items[0] : (view.items.find((i) => i.id === view.selectedId) ?? null)) : null;
  const current = currentItem?.outcome === "done" ? currentItem : null;
  const currentId = current?.id ?? null;

  const onGenerated = useCallback(
    async (json: AiDocumentJson) => {
      const controller = controllerRef.current;
      const shown = viewRef.current;
      if (!controller || shown.kind !== "result" || !currentId) return;
      const target = shown.items.find((i) => i.id === currentId);
      if (!target || target.outcome !== "done") return;
      const rendered = await controller.render(target.result.report, json);
      const ai: AiResult = { json, ...rendered, mock: aiStatus?.mode === "mock" };
      setView((v) =>
        v.kind === "result" ? { ...v, items: v.items.map((i) => (i.id === currentId && i.outcome === "done" && i.result === target.result ? { ...i, ai } : i)) } : v,
      );
      setAiOpen(false);
      setTab("ai");
    },
    [aiStatus, currentId],
  );

  const resultReport = current?.result.report ?? null;
  // 解析結果ごとに作り直す。同じ選択肢の依頼は使い回し、別の選択肢は前の依頼の後に続けて実行する
  const payloadMemoRef = useRef<{ report: NonNullable<typeof resultReport>; build: (includeSource: boolean) => Promise<AiPayload> } | null>(null);
  const buildAiPayload = useCallback(
    (includeSource: boolean): Promise<AiPayload> => {
      const controller = controllerRef.current;
      if (!controller || !resultReport) return Promise.reject(new CancelledError());
      let memo = payloadMemoRef.current;
      if (!memo || memo.report !== resultReport) {
        memo = {
          report: resultReport,
          build: serialMemo((source: boolean) => controller.buildAiPayload(resultReport, source, CONSENT_VERSION)),
        };
        payloadMemoRef.current = memo;
      }
      return memo.build(includeSource);
    },
    [resultReport],
  );

  const backToSelect = () => setView({ kind: "select" });
  const selectFile = (id: string | null) => {
    setAiOpen(false);
    setTab("overview");
    setView((v) => (v.kind === "result" ? { ...v, selectedId: id } : v));
  };
  const confirmAnalyzeAnother = () => {
    if (window.confirm("いまの解析結果は消えます。よろしいですか?(必要なら先に保存してください)")) backToSelect();
  };

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
                  <span className="whitespace-pre-line">{view.notice}</span>
                </Notice>
              </div>
            )}
            <FilePicker onFiles={(files) => void analyze(files)} />
          </div>
          <SampleList samples={samples} onSelect={(s) => void trySample(s)} />
        </>
      )}
      {view.kind === "analyzing" && (
        <AnalyzingView
          fileName={view.fileName}
          phase={view.phase}
          startedAt={view.startedAt}
          index={view.index}
          total={view.total}
          onCancel={() => {
            cancelledRef.current = true;
            controllerRef.current?.cancel();
          }}
        />
      )}
      {view.kind === "error" && <ErrorView fileName={view.fileName} failure={view.failure} onBack={backToSelect} />}
      {view.kind === "result" && (
        <>
          {!currentItem && (
            <InventoryListView
              items={view.items}
              onSelect={selectFile}
              onAnalyzeAnother={confirmAnalyzeAnother}
              contactUrl={contactUrl}
              diagnosisUrl={diagnosisUrl}
            />
          )}
          {current && (
            <ResultView
              fileName={current.fileName}
              result={current.result}
              ai={current.ai}
              aiAvailable={Boolean(aiStatus?.available)}
              selectedTab={tab}
              onSelectTab={setTab}
              onOpenAi={() => setAiOpen(true)}
              contactUrl={contactUrl}
              diagnosisUrl={diagnosisUrl}
              onBackToList={view.items.length > 1 ? () => selectFile(null) : undefined}
              onAnalyzeAnother={confirmAnalyzeAnother}
            />
          )}
          {current && aiStatus?.available && aiOpen && (
            <AiConsentDialog
              open={aiOpen}
              onClose={() => setAiOpen(false)}
              format={current.result.report.file.format}
              fileName={current.fileName}
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
