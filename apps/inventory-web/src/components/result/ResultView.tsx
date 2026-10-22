"use client";

import type { AnalysisResult } from "@/worker/protocol";
import { DocumentView } from "../DocumentView";
import { PrivacyBadge } from "../PrivacyBadge";
import { Tabs, type TabDef } from "../Tabs";
import { buttonPrimary, buttonSecondary } from "../ui";
import { AccessTab } from "./AccessTab";
import { AiTab } from "./AiTab";
import { DependenciesTab } from "./DependenciesTab";
import { ExportActions } from "./ExportActions";
import { FlowTab } from "./FlowTab";
import { NextStepLinks } from "./NextStepLinks";
import { ModulesTab } from "./ModulesTab";
import { OverviewTab } from "./OverviewTab";
import { RisksTab } from "./RisksTab";
import { SheetsTab } from "./SheetsTab";
import type { AiResult } from "./types";

export function ResultView({
  fileName,
  result,
  ai,
  aiAvailable,
  selectedTab,
  onSelectTab,
  onOpenAi,
  onAnalyzeAnother,
  onBackToList,
  contactUrl,
  diagnosisUrl,
}: {
  fileName: string;
  result: AnalysisResult;
  ai: AiResult | null;
  aiAvailable: boolean;
  selectedTab: string;
  onSelectTab: (id: string) => void;
  onOpenAi: () => void;
  onAnalyzeAnother: () => void;
  /** 複数ファイルのときだけ。棚卸し一覧に戻る */
  onBackToList?: () => void;
  contactUrl: string | null;
  diagnosisUrl: string | null;
}) {
  const { derived, report } = result;
  const moduleCount = report.vba?.modules.length ?? 0;
  const dependencyCount = derived.dependencyGroups.filter((g) => g.kind !== "reference").length + (report.vba?.references.length ? 1 : 0);
  const tabs: TabDef[] = [
    { id: "overview", label: "概要", content: <OverviewTab result={result} onShowRisks={() => onSelectTab("risks")} /> },
    {
      id: "risks",
      label: `リスク(${derived.findings.length})`,
      content: <RisksTab findings={derived.findings} />,
    },
    { id: "flow", label: "処理の流れ", content: <FlowTab result={result} /> },
  ];
  if (moduleCount > 0) {
    tabs.push({ id: "modules", label: `モジュール・処理(${moduleCount})`, content: <ModulesTab result={result} /> });
  }
  if (dependencyCount > 0) {
    tabs.push({ id: "dependencies", label: "依存関係", content: <DependenciesTab result={result} /> });
  }
  if (report.excel) tabs.push({ id: "sheets", label: `シート(${report.excel.sheets.length})`, content: <SheetsTab result={result} /> });
  if (report.access) tabs.push({ id: "access", label: "Access", content: <AccessTab result={result} /> });
  tabs.push(
    {
      id: "document",
      label: "仕様書(全文)",
      content: (
        <div className="rounded-xl border border-line bg-surface p-4 sm:p-6">
          <DocumentView doc={result.document} purpose="document" />
        </div>
      ),
    },
  );
  if (ai) {
    tabs.push({
      id: "ai",
      label: "AIによる解説",
      content: <AiTab ai={ai} actions={<ExportActions fileName={fileName} doc={ai.document} variant="ai" />} />,
    });
  }
  const printDoc = selectedTab === "ai" && ai ? ai.document : result.document;

  return (
    <>
      <div className="screen-only">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold sm:text-2xl">
              棚卸しの結果: <span className="break-all">{fileName}</span>
            </h1>
            <p className="mt-1 text-sm text-ink-2">結果はこのタブの中だけにあり、タブを閉じると消えます。必要なら保存してください。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onBackToList && (
              <button type="button" className={buttonSecondary} onClick={onBackToList}>
                棚卸し一覧に戻る
              </button>
            )}
            <button type="button" className={buttonSecondary} onClick={onAnalyzeAnother}>
              {onBackToList ? "別のファイルを解析(結果を消去)" : "別のファイルを解析"}
            </button>
          </div>
        </div>
        <div className="mt-3">
          <PrivacyBadge />
        </div>
        <div className="mt-4 flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 lg:flex-row lg:items-start lg:justify-between">
          <ExportActions fileName={fileName} doc={result.document} json={() => JSON.stringify(result.report, null, 2)} variant="standard" />
          {aiAvailable && (
            <div className="no-print max-w-sm">
              <button type="button" className={buttonPrimary} onClick={onOpenAi}>
                {ai ? "AIで仕様書を作り直す" : "AIで詳しい仕様書を作る"}
              </button>
              <p className="mt-1 text-xs text-ink-2">送信する内容を確認し、同意したときだけ送ります。</p>
            </div>
          )}
        </div>
        <Tabs tabs={tabs} selected={selectedTab} onSelect={onSelectTab} label="解析結果" />
        <NextStepLinks contactUrl={contactUrl} diagnosisUrl={diagnosisUrl} />
      </div>
      <div className="print-only" aria-hidden="true">
        <DocumentView key={printDoc === result.document ? "standard" : "ai"} doc={printDoc} purpose="print" />
      </div>
    </>
  );
}
