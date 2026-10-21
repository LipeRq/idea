"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AiRequestError, requestAiDocument, type AiStatus } from "@/lib/ai-client";
import type { AiDocumentJson } from "@/lib/ai-json";
import { ANTHROPIC_PRIVACY_URL, CONSENT_OWNER_LABEL, CONSENT_SEND_LABEL, DESTINATION_TEXT, RETENTION_TEXT } from "@/lib/ai-consent";
import { AnalysisFailure } from "@/lib/analysis-controller";
import { formatFileSize } from "@/lib/browser-limits";
import { describeFailure } from "@/lib/errors";
import { downloadText, exportFileName } from "@/lib/export";
import type { AiPayload } from "@/worker/protocol";
import { ExternalLink } from "./ExternalLink";
import { ShowMore } from "./ShowMore";
import { buttonPrimary, buttonSecondary, inputClass, Notice } from "./ui";

type Stage =
  /** 送信内容を作っている(作り直しのときは前の内容を表示したままにする。送信はできない) */
  | { kind: "preparing"; previous?: AiPayload }
  | { kind: "review"; payload: AiPayload }
  | { kind: "prepareFailed"; message: string }
  | { kind: "sending"; payload: AiPayload; progress: string; startedAt: number }
  | { kind: "rendering"; payload: AiPayload };

const n = (v: number) => v.toLocaleString("ja-JP");

function limitProblems(payload: AiPayload, status: AiStatus): string[] {
  const problems: string[] = [];
  if (payload.bodyBytes > status.maxBodyBytes) {
    problems.push(`送信内容の大きさ(${formatFileSize(payload.bodyBytes)})が上限(${formatFileSize(status.maxBodyBytes)})を超えています。`);
  }
  if (payload.estimate.inputTokens > status.maxInputTokens) {
    problems.push(`AI への入力の大きさ(約 ${n(payload.estimate.inputTokens)} トークン)が上限(${n(status.maxInputTokens)})を超えています。`);
  }
  if (payload.estimate.batches > status.maxBatches) {
    problems.push(`要約の依頼の回数(${payload.estimate.batches} 回)が上限(${status.maxBatches} 回)を超えています。`);
  }
  return problems;
}

export function AiConsentDialog({
  open,
  onClose,
  format,
  fileName,
  status,
  buildPayload,
  privacyUrl,
  contactUrl,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  /** 元のファイルの形式(送らないものの説明に使う) */
  format: string;
  fileName: string;
  status: AiStatus;
  /** 送信内容を Worker で作る(includeSource: ソースコード本文と SQL を含めるか) */
  buildPayload: (includeSource: boolean) => Promise<AiPayload>;
  privacyUrl: string | null;
  contactUrl: string | null;
  /** AI の文章を受け取ったら、Worker で仕様書にして結果画面に追加する */
  onGenerated: (ai: AiDocumentJson) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: "preparing" });
  const [includeSource, setIncludeSource] = useState(true);
  const [agreeSend, setAgreeSend] = useState(false);
  const [agreeOwner, setAgreeOwner] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const titleId = useId();
  const sendId = useId();
  const ownerId = useId();
  const codeId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // 送信内容を作る(Worker で。画面とサーバーで同じ見積もりをする)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    buildPayload(includeSource).then(
      (payload) => alive && setStage({ kind: "review", payload }),
      (e: unknown) =>
        alive &&
        setStage({
          kind: "prepareFailed",
          message: e instanceof AnalysisFailure ? describeFailure(e.failure).title : "送信内容を作れませんでした。",
        }),
    );
    return () => {
      alive = false;
    };
  }, [open, includeSource, buildPayload]);

  useEffect(() => {
    if (stage.kind !== "sending") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [stage.kind]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setError(null);
    onClose();
  }, [onClose]);

  const send = async (payload: AiPayload) => {
    setError(null);
    const abort = new AbortController();
    abortRef.current = abort;
    setStage({ kind: "sending", payload, progress: "送信しています", startedAt: Date.now() });
    setNow(Date.now());
    try {
      const ai = await requestAiDocument({
        body: payload.body,
        accessCode: status.requiresAccessCode ? accessCode : undefined,
        signal: abort.signal,
        onProgress: (progress) => setStage((s) => (s.kind === "sending" ? { ...s, progress } : s)),
      });
      setStage({ kind: "rendering", payload });
      await onGenerated(ai);
      abortRef.current = null;
    } catch (e) {
      if (abort.signal.aborted) return;
      abortRef.current = null;
      setError(e instanceof AiRequestError ? e.message : e instanceof AnalysisFailure ? describeFailure(e.failure).title : "AI版を作れませんでした。時間をおいてお試しください。");
      setStage({ kind: "review", payload });
    }
  };

  const payload = stage.kind === "prepareFailed" ? null : stage.kind === "preparing" ? (stage.previous ?? null) : stage.payload;
  const problems = payload ? limitProblems(payload, status) : [];
  const busy = stage.kind === "sending" || stage.kind === "rendering";
  const canSend = stage.kind === "review" && problems.length === 0 && agreeSend && agreeOwner && (!status.requiresAccessCode || accessCode.trim() !== "");

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="m-auto max-h-[92vh] w-[min(56rem,calc(100vw-1rem))] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      <div className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-bold">
            AIで詳しい仕様書を作る
          </h2>
          <button type="button" className={buttonSecondary} onClick={close}>
            {busy ? "中止" : "閉じる"}
          </button>
        </div>
        {status.mode === "mock" && (
          <p className="mt-2 inline-block rounded border border-warning bg-warning-soft px-2 py-0.5 text-sm text-warning">
            デモ用の固定文章で動作中(実際の AI は呼びません)
          </p>
        )}
        <p className="mt-3">
          AI(Anthropic 社の Claude)が、概要・業務の流れ・リスクの評価・移行先の提案を書き足した仕様書を作ります。そのために、下の内容をサーバーに送信します。
          <strong>送信するのは、下で同意して「同意してAI版を作成」を押したときだけです。</strong>
        </p>

        {stage.kind === "preparing" && (
          <p role="status" className="mt-4 text-sm text-ink-2">
            送信する内容を確認しています…
          </p>
        )}
        {stage.kind === "prepareFailed" && (
          <div className="mt-4">
            <Notice level="critical" role="alert">
              {stage.message}
            </Notice>
          </div>
        )}

        {payload && (
          <div className="mt-4 space-y-5">
            <section aria-labelledby={`${titleId}-not`}>
              <h3 id={`${titleId}-not`} className="font-bold">
                送らないもの
              </h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                <li>ファイル本体と、シートのセルの値(データ本体。最初から読み取っていません)</li>
                <li>元のファイル名(「対象ファイル.{format}」に置き換えます)・ファイルの指紋(SHA-256)・ファイルの大きさ</li>
                <li>文書の情報に記録された作成者・最終更新者・会社名・タイトル・作成したアプリの名前と版、作成・更新の月日と時刻(年だけ送ります)</li>
                <li>解析の警告</li>
              </ul>
            </section>
            <section aria-labelledby={`${titleId}-mask`}>
              <h3 id={`${titleId}-mask`} className="font-bold">
                伏せ字にして送るもの
              </h3>
              <p className="mt-1 text-sm">
                検出できたパスワード(接続文字列の Password= や、パスワードらしい名前の変数への代入など)は「****」に置き換え済みです(
                {payload.summary.maskedCredentials} か所)。検出はパターンによるもので、漏れがありえます。
              </p>
            </section>
            <section aria-labelledby={`${titleId}-send`}>
              <h3 id={`${titleId}-send`} className="font-bold">
                そのまま送るもの
              </h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                {includeSource ? (
                  <li>
                    マクロ(VBA)のソースコード: モジュール {payload.summary.modulesWithSource} 件・{n(payload.summary.codeLines)} 行(コメント・文字列を含む)
                  </li>
                ) : (
                  <li>マクロのソースコード本文は送りません(モジュール名・処理の名前・行数・呼び出し関係は送ります)</li>
                )}
                {payload.summary.queries + payload.summary.hiddenQueries > 0 && (
                  <li>
                    Access のクエリ: 保存済みのクエリ {payload.summary.queries} 件
                    {payload.summary.hiddenQueries > 0 && `、フォーム・レポートの内部のクエリ ${payload.summary.hiddenQueries} 件`}
                    {includeSource ? `(SQL ${payload.summary.queriesWithSql} 件を含む)` : "(SQL の本文は送りません)"}
                  </li>
                )}
                <li>シート名・数式の例・名前定義、テーブル名・列名・行数(シート {payload.summary.sheets} 枚、テーブル {payload.summary.tables} 個)</li>
                <li>Access のフォーム・レポート・マクロ・モジュールの名前、リンクテーブルの参照先(データベースのパス・接続文字列。パスワードは伏せ字)</li>
                <li>シートのボタン・図形に表示された文字と、登録されたマクロの名前</li>
                <li>VBA プロジェクトの名前、参照設定(ライブラリの名前とファイルのパス)、ファイルの形式、作成・更新の年</li>
                <li>コードから取り出した SQL 文・接続文字列・ファイルのパス・URL など({n(payload.summary.dependencies)} 件。パスワードは伏せ字)</li>
                <li>呼び出し関係・起動のきっかけ・機械的に検出したリスク・規模の件数</li>
                <li>
                  <strong>
                    コード・コメント・数式・パスの中に書かれた氏名・メールアドレス・電話番号・会社名・ファイル名・APIキー・トークン・Webhook の URL(伏せ字の対象外です)
                  </strong>
                </li>
              </ul>
            </section>

            <section aria-labelledby={`${titleId}-hits`}>
              <h3 id={`${titleId}-hits`} className="font-bold">
                送信内容の中の、注意が必要な文字列
              </h3>
              {payload.sensitive.total === 0 ? (
                <p className="mt-1 text-sm">メールアドレス・電話番号・トークンなどに見える文字列は見つかりませんでした(検出は完全ではありません)。</p>
              ) : (
                <>
                  <Notice level="warning">
                    {payload.sensitive.total} 件見つかりました。これらは<strong>伏せ字にされずにそのまま送られます</strong>
                    。送りたくない場合は、ファイルから消したコピーで解析し直すか、AI版を使わずに標準の仕様書をお使いください。
                  </Notice>
                  <ShowMore
                    items={payload.sensitive.hits}
                    pageSize={30}
                    label="注意が必要な文字列"
                    className="mt-2 space-y-1 text-sm"
                    render={(h, i) => (
                      <li key={i} className="rounded border border-line px-2 py-1">
                        <span className="font-semibold">{h.label}</span>
                        <span className="ml-2 text-ink-2">{h.location}</span>
                        <code className="mt-0.5 block break-all text-xs">{h.excerpt}</code>
                      </li>
                    )}
                  />
                  {payload.sensitive.total > payload.sensitive.hits.length && (
                    <p className="mt-1 text-xs text-ink-2">ほか {payload.sensitive.total - payload.sensitive.hits.length} 件(表示は先頭の {payload.sensitive.hits.length} 件まで)</p>
                  )}
                </>
              )}
            </section>

            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={!includeSource} disabled={busy} onChange={(e) => {
              // 送信内容を作り直す(作り終わるまで送信できない)
              setStage((s) => ({ kind: "preparing", previous: s.kind === "review" ? s.payload : undefined }));
              setIncludeSource(!e.currentTarget.checked);
            }} />
              <span>ソースコード本文とクエリの SQL を送らない(要約の精度は下がります。コードから取り出した SQL 文・URL・パスなどは送られます)</span>
            </label>

            <section aria-labelledby={`${titleId}-size`} className="text-sm">
              <h3 id={`${titleId}-size`} className="font-bold">
                送信の大きさ
              </h3>
              <p className="mt-1">
                {formatFileSize(payload.bodyBytes)}(上限 {formatFileSize(status.maxBodyBytes)})/ AI への入力 約 {n(payload.estimate.inputTokens)} トークン(上限 {n(status.maxInputTokens)})/
                要約の依頼 {payload.estimate.batches} 回(上限 {status.maxBatches} 回)
              </p>
              {problems.length > 0 && (
                <div className="mt-2">
                  <Notice level="critical" role="alert">
                    大きすぎるため、AI版は作れません。標準の仕様書をお使いいただくか、ご相談ください。
                    <ul className="mt-1 list-disc pl-5">
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                    {contactUrl && (
                      <ExternalLink href={contactUrl} className="mt-1 inline-block underline underline-offset-2">
                        相談する
                      </ExternalLink>
                    )}
                  </Notice>
                </div>
              )}
              <button
                type="button"
                className="mt-2 text-accent-ink underline underline-offset-2"
                onClick={() => downloadText(exportFileName(fileName, "aiPayload"), payload.body, "application/json;charset=utf-8")}
              >
                送信内容を保存(JSON。送る文字列そのものです)
              </button>
            </section>

            <section aria-labelledby={`${titleId}-dest`} className="text-sm">
              <h3 id={`${titleId}-dest`} className="font-bold">
                送信先と保存
              </h3>
              <p className="mt-1">{DESTINATION_TEXT}</p>
              <p className="mt-1">
                {RETENTION_TEXT}
                <ExternalLink href={ANTHROPIC_PRIVACY_URL} className="ml-1 text-accent-ink underline underline-offset-2">
                  Anthropic 社の規約
                </ExternalLink>
                {privacyUrl && (
                  <>
                    ・
                    <ExternalLink href={privacyUrl} className="text-accent-ink underline underline-offset-2">
                      プライバシーポリシー
                    </ExternalLink>
                  </>
                )}
              </p>
              <p className="mt-1 font-semibold">個人情報を含むコードは送らないでください。</p>
            </section>

            <div className="space-y-2 rounded-lg border border-line-strong p-3">
              <label htmlFor={sendId} className="flex items-start gap-2">
                <input id={sendId} type="checkbox" className="mt-1" checked={agreeSend} disabled={busy} onChange={(e) => setAgreeSend(e.currentTarget.checked)} />
                <span>{CONSENT_SEND_LABEL}</span>
              </label>
              <label htmlFor={ownerId} className="flex items-start gap-2">
                <input id={ownerId} type="checkbox" className="mt-1" checked={agreeOwner} disabled={busy} onChange={(e) => setAgreeOwner(e.currentTarget.checked)} />
                <span>{CONSENT_OWNER_LABEL}</span>
              </label>
              {status.requiresAccessCode && (
                <div className="pt-1">
                  <label htmlFor={codeId} className="block text-sm font-semibold">
                    アクセスコード
                  </label>
                  <input
                    id={codeId}
                    type="password"
                    autoComplete="off"
                    className={`${inputClass} mt-1 max-w-xs`}
                    value={accessCode}
                    disabled={busy}
                    onChange={(e) => setAccessCode(e.currentTarget.value)}
                  />
                  <p className="mt-1 text-xs text-ink-2">AI版は、運営者からアクセスコードを受け取った方だけが使えます。</p>
                </div>
              )}
            </div>

            {error && (
              <Notice level="critical" role="alert">
                {error}
              </Notice>
            )}

            {stage.kind === "sending" || stage.kind === "rendering" ? (
              <div role="status" aria-live="polite" className="rounded-lg border border-accent bg-accent-soft p-3 text-sm text-accent-ink">
                {stage.kind === "sending" ? (
                  <>
                    AI版を作成しています: {stage.progress}(経過 {Math.max(0, Math.floor((now - stage.startedAt) / 1000))} 秒。数分かかることがあります)
                  </>
                ) : (
                  "AI版の仕様書をまとめています…"
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonPrimary} disabled={!canSend} onClick={() => stage.kind === "review" && void send(stage.payload)}>
                  同意してAI版を作成
                </button>
                <button type="button" className={buttonSecondary} onClick={close}>
                  やめる
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
