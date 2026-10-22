"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BaselineRowSchema, MAX_BASELINE_ROWS, REQUEST_KIND_LABEL, REQUEST_KINDS, type BaselineRow } from "@/lib/domain/impact";
import { parseBaselineCsv, type CsvImportError } from "@/lib/impact/baseline-csv";
import { baselineRowToRecord, countEstimatedRows } from "@/lib/impact/baseline-records";
import { KPI_DEFS, formatKpiValue } from "@/lib/impact/definitions";
import { computeKpis, isReference } from "@/lib/impact/kpi";
import { Notice, buttonPrimary, buttonSecondary, inputClass } from "../ui";
import { useHydrated } from "../useHydrated";

// ベースライン(導入前の記録シート。PoC計画書 5章)の入力・取り込み・保存。
// 手入力、CSV(Excelの表の貼り付けを含む)の取り込みのどちらでも、同じ形で保存する。

type Origin = "saved" | "demo" | "none";

const EMPTY_FORM = {
  receivedAt: "",
  customer: "",
  partName: "",
  kind: "",
  drawingCount: "",
  estimator: "",
  salesMinutes: "",
  estimatorMinutes: "",
  answeredAt: "",
  customerInquiry: "",
  result: "",
  memo: "",
  orderAmount: "",
  quotedCost: "",
  actualCost: "",
  reworkCount: "",
};
type Form = typeof EMPTY_FORM;

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

function toRow(f: Form): { row?: BaselineRow; error?: string } {
  if (!f.receivedAt) return { error: "受付日を入力してください" };
  const numbers: [string, string][] = [
    ["図面枚数", f.drawingCount],
    ["作業時間:営業・事務", f.salesMinutes],
    ["作業時間:見積担当", f.estimatorMinutes],
    ["受注額", f.orderAmount],
    ["見積原価", f.quotedCost],
    ["実績原価", f.actualCost],
    ["手戻り件数", f.reworkCount],
  ];
  for (const [label, v] of numbers) {
    if (v.trim() !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0)) return { error: `${label}は0以上の数で入力してください` };
  }
  if (f.answeredAt && f.answeredAt < f.receivedAt) return { error: "回答日は受付日以降にしてください" };
  const parsed = BaselineRowSchema.safeParse({
    receivedAt: f.receivedAt,
    customer: f.customer.trim(),
    partName: f.partName.trim(),
    kind: f.kind === "" ? null : f.kind,
    drawingCount: num(f.drawingCount),
    estimator: f.estimator.trim(),
    salesMinutes: num(f.salesMinutes),
    estimatorMinutes: num(f.estimatorMinutes),
    answeredAt: f.answeredAt === "" ? null : f.answeredAt,
    customerInquiry: f.customerInquiry === "" ? null : f.customerInquiry === "yes",
    result: f.result === "" ? null : f.result,
    memo: f.memo.trim(),
    orderAmount: num(f.orderAmount),
    quotedCost: num(f.quotedCost),
    actualCost: num(f.actualCost),
    reworkCount: num(f.reworkCount),
  });
  if (!parsed.success) return { error: "入力内容に誤りがあります(日付は2000〜2100年、図面枚数・手戻り件数は整数にしてください)" };
  return { row: parsed.data };
}

function splitNames(text: string): string[] {
  return [...new Set(text.split(/[\n、,]/).map((s) => s.trim()).filter(Boolean))].slice(0, 20);
}

/** CSVのファイルを読む。Excelの日本語CSVは Shift_JIS のことがあるので、UTF-8で読めなければ Shift_JIS にする */
async function readFileText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

const ORIGIN_NOTE: Record<Origin, string> = {
  saved: "保存済みのベースラインです。",
  demo: "デモ用の架空のベースラインを表示しています。保存すると、御社のベースラインとして置き換わります(元のデモ用データは消えません)。",
  none: "ベースラインはまだありません。手入力かCSVの取り込みで追加してください。",
};

export function BaselineEditor(props: {
  initial: { estimators: string[]; note: string; rows: BaselineRow[] };
  origin: Origin;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [rows, setRows] = useState(props.initial.rows);
  const [estimatorsText, setEstimatorsText] = useState(props.initial.estimators.join("\n"));
  const [note, setNote] = useState(props.initial.note);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [csvText, setCsvText] = useState("");
  const [importErrors, setImportErrors] = useState<CsvImportError[]>([]);
  const [message, setMessage] = useState<{ level: "info" | "error"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const estimators = useMemo(() => splitNames(estimatorsText), [estimatorsText]);
  const kpis = useMemo(() => computeKpis(rows.map(baselineRowToRecord), estimators), [rows, estimators]);
  const estimatedRows = countEstimatedRows(rows);

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const addRow = (e: React.FormEvent) => {
    e.preventDefault();
    const { row, error } = toRow(form);
    if (!row) {
      setFormError(error ?? "入力内容に誤りがあります");
      return;
    }
    if (rows.length >= MAX_BASELINE_ROWS) {
      setFormError(`追加できるのは${MAX_BASELINE_ROWS}行までです`);
      return;
    }
    setRows((r) => [...r, row].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)));
    // 続けて入力しやすいよう、受付日と見積担当は残す
    setForm({ ...EMPTY_FORM, receivedAt: form.receivedAt, estimator: form.estimator });
    setFormError(null);
    setDirty(true);
    setMessage({ level: "info", text: "1行を追加しました。「保存」を押すと確定します。" });
  };

  const importCsv = (mode: "append" | "replace") => {
    const result = parseBaselineCsv(csvText);
    setImportErrors(result.errors);
    if (result.rows.length === 0) {
      setMessage({ level: "error", text: "取り込める行がありませんでした。" });
      return;
    }
    const merged = (mode === "replace" ? result.rows : [...rows, ...result.rows]).slice(0, MAX_BASELINE_ROWS);
    setRows([...merged].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)));
    setDirty(true);
    setCsvText("");
    setMessage({
      level: result.ok ? "info" : "error",
      text: `${result.rows.length}行を取り込みました${result.errors.length > 0 ? `(${result.errors.length}件の誤りは取り込んでいません)` : ""}。「保存」を押すと確定します。`,
    });
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 512 * 1024) {
      setMessage({ level: "error", text: "ファイルが大きすぎます(512KBまで)" });
      return;
    }
    setCsvText(await readFileText(file));
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/impact/baseline", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimators, note: note.trim().slice(0, 300), rows }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ level: "error", text: json?.error ?? "保存に失敗しました。時間をおいてもう一度お試しください。" });
      } else {
        setDirty(false);
        setMessage({ level: "info", text: `ベースラインを保存しました(${rows.length}行)。ダッシュボードの導入前の値に反映されます。` });
        router.refresh();
      }
    } catch {
      setMessage({ level: "error", text: "通信エラーが発生しました。もう一度お試しください。" });
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    const res = await fetch("/api/impact/baseline", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setConfirmDelete(false);
    if (res?.ok) {
      setMessage({ level: "info", text: "保存したベースラインを削除しました。画面を読み込み直します。" });
      window.location.reload();
    } else setMessage({ level: "error", text: "削除に失敗しました。" });
  };

  const fieldClass = `${inputClass} py-1.5 text-sm`;
  const label = "space-y-1 text-sm";

  return (
    <div className="space-y-8">
      <Notice level={props.origin === "demo" ? "warning" : "info"}>{ORIGIN_NOTE[props.origin]}</Notice>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5" aria-labelledby="bl-names">
        <h2 id="bl-names" className="text-lg font-bold">
          1. 見積担当者の名簿
        </h2>
        <p className="text-sm text-ink-2">
          「見積担当者以外が作成した割合」の計算に使います。1行に1人、または読点で区切って入れます。記録シートの「見積担当」と部分一致で照合します(「白石」と「代表取締役 白石」は同じ人)。
        </p>
        <label className={label}>
          <span className="font-medium">見積担当者</span>
          <textarea
            className={`${fieldClass} min-h-20`}
            value={estimatorsText}
            disabled={!hydrated}
            onChange={(e) => {
              setEstimatorsText(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        <label className={label}>
          <span className="font-medium">メモ(計測期間・対象など。任意)</span>
          <input
            className={fieldClass}
            value={note}
            maxLength={300}
            disabled={!hydrated}
            onChange={(e) => {
              setNote(e.target.value);
              setDirty(true);
            }}
            placeholder="例:2026年7月の4週間。新規とリピートの全件"
          />
        </label>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5" aria-labelledby="bl-csv">
        <h2 id="bl-csv" className="text-lg font-bold">
          2. CSVで取り込む
        </h2>
        <p className="text-sm text-ink-2">
          PoC計画書 5章の記録シートの列(受付日時・お客様・品名・図番・種類・図面枚数・見積担当・作業時間・回答日時・お客様への問い合わせ・受注/失注・メモ)を、見出し行つきで貼り付けるか、ファイルを選びます。Excelの表をそのまま貼り付けてもかまいません。列の順番は問いません。
          <a className="ml-1 text-accent-ink underline" href="/api/impact/export?format=csv&part=template">
            見出しだけのCSVをダウンロード
          </a>
        </p>
        <label className={label}>
          <span className="font-medium">CSVファイル(UTF-8またはShift_JIS)</span>
          <input type="file" accept=".csv,.tsv,.txt,text/csv" className="block text-sm" disabled={!hydrated} onChange={onFile} />
        </label>
        <label className={label}>
          <span className="font-medium">CSVの内容を貼り付け</span>
          <textarea
            className={`${fieldClass} min-h-28 font-mono`}
            value={csvText}
            disabled={!hydrated}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"受付日時,お客様,品名・図番,種類(新規/リピート/改訂),図面枚数,見積担当,作業時間:営業・事務(分),作業時間:見積担当(分),回答日時,お客様への問い合わせ,受注/失注,メモ"}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonSecondary} disabled={!hydrated || csvText.trim() === ""} onClick={() => importCsv("append")}>
            今の行に追加する
          </button>
          <button type="button" className={buttonSecondary} disabled={!hydrated || csvText.trim() === ""} onClick={() => importCsv("replace")}>
            今の行を置き換える
          </button>
        </div>
        {importErrors.length > 0 && (
          <div role="alert" className="rounded-lg border border-critical bg-critical-soft px-4 py-3 text-sm text-critical-ink" data-testid="import-errors">
            <p className="font-semibold">取り込めなかった行があります</p>
            <ul className="mt-1 list-disc pl-5">
              {importErrors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  {e.line > 0 ? `${e.line}行目:` : ""}
                  {e.message}
                </li>
              ))}
            </ul>
            {importErrors.length > 20 && <p className="mt-1">ほか{importErrors.length - 20}件</p>}
          </div>
        )}
      </section>

      <form className="space-y-4 rounded-xl border border-line bg-surface p-5" onSubmit={addRow} noValidate aria-labelledby="bl-form">
        <h2 id="bl-form" className="text-lg font-bold">
          3. 1件ずつ入力する
        </h2>
        <p className="text-sm text-ink-2">
          作業時間は「その見積のために手を動かした時間」の合計です(お客様の返事待ちは含めません)。実測できず推定した行は、メモに「推定」と書くと、報告書に件数が出ます。
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={label}>
            <span className="font-medium">受付日(必須)</span>
            <input type="date" className={fieldClass} value={form.receivedAt} disabled={!hydrated} onChange={set("receivedAt")} />
          </label>
          <label className={label}>
            <span className="font-medium">お客様</span>
            <input className={fieldClass} value={form.customer} disabled={!hydrated} onChange={set("customer")} />
          </label>
          <label className={label}>
            <span className="font-medium">品名・図番</span>
            <input className={fieldClass} value={form.partName} disabled={!hydrated} onChange={set("partName")} />
          </label>
          <label className={label}>
            <span className="font-medium">種類</span>
            <select className={fieldClass} value={form.kind} disabled={!hydrated} onChange={set("kind")}>
              <option value="">未記入</option>
              {REQUEST_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REQUEST_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            <span className="font-medium">図面枚数</span>
            <input type="number" min="0" step="1" className={fieldClass} value={form.drawingCount} disabled={!hydrated} onChange={set("drawingCount")} />
          </label>
          <label className={label}>
            <span className="font-medium">見積担当</span>
            <input className={fieldClass} list="bl-estimators" value={form.estimator} disabled={!hydrated} onChange={set("estimator")} />
            <datalist id="bl-estimators">
              {estimators.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label className={label}>
            <span className="font-medium">作業時間:営業・事務(分)</span>
            <input type="number" min="0" step="any" className={fieldClass} value={form.salesMinutes} disabled={!hydrated} onChange={set("salesMinutes")} />
          </label>
          <label className={label}>
            <span className="font-medium">作業時間:見積担当(分)</span>
            <input type="number" min="0" step="any" className={fieldClass} value={form.estimatorMinutes} disabled={!hydrated} onChange={set("estimatorMinutes")} />
          </label>
          <label className={label}>
            <span className="font-medium">回答日</span>
            <input type="date" className={fieldClass} value={form.answeredAt} disabled={!hydrated} onChange={set("answeredAt")} />
          </label>
          <label className={label}>
            <span className="font-medium">お客様への問い合わせ</span>
            <select className={fieldClass} value={form.customerInquiry} disabled={!hydrated} onChange={set("customerInquiry")}>
              <option value="">未記入</option>
              <option value="yes">あり</option>
              <option value="no">なし</option>
            </select>
          </label>
          <label className={label}>
            <span className="font-medium">受注/失注</span>
            <select className={fieldClass} value={form.result} disabled={!hydrated} onChange={set("result")}>
              <option value="">未定</option>
              <option value="won">受注</option>
              <option value="lost">失注</option>
            </select>
          </label>
          <label className={label}>
            <span className="font-medium">メモ</span>
            <input className={fieldClass} value={form.memo} maxLength={200} disabled={!hydrated} onChange={set("memo")} />
          </label>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-accent-ink hover:underline">任意の列(見積と実績の差・手戻りを導入前と比べるとき)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={label}>
              <span className="font-medium">受注額(円・税抜)</span>
              <input type="number" min="0" className={fieldClass} value={form.orderAmount} disabled={!hydrated} onChange={set("orderAmount")} />
            </label>
            <label className={label}>
              <span className="font-medium">見積原価(円)</span>
              <input type="number" min="0" className={fieldClass} value={form.quotedCost} disabled={!hydrated} onChange={set("quotedCost")} />
            </label>
            <label className={label}>
              <span className="font-medium">実績原価(円)</span>
              <input type="number" min="0" className={fieldClass} value={form.actualCost} disabled={!hydrated} onChange={set("actualCost")} />
            </label>
            <label className={label}>
              <span className="font-medium">手戻り件数</span>
              <input type="number" min="0" step="1" className={fieldClass} value={form.reworkCount} disabled={!hydrated} onChange={set("reworkCount")} />
            </label>
          </div>
        </details>
        {formError && (
          <p role="alert" className="text-sm text-critical-ink">
            {formError}
          </p>
        )}
        <button type="submit" className={buttonSecondary} disabled={!hydrated}>
          この行を追加
        </button>
      </form>

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5" aria-labelledby="bl-rows">
        <h2 id="bl-rows" className="text-lg font-bold">
          4. 記録の一覧と、この内容での導入前の値
        </h2>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="baseline-preview">
          {KPI_DEFS.filter((d) => d.direction !== "none").map((d) => {
            const s = d.stat(kpis);
            return (
              <div key={d.id} className="rounded-lg border border-line px-3 py-2">
                <p className="text-xs text-ink-2">{d.name}</p>
                <p className="font-bold tabular-nums">
                  {s.value === null ? "対象なし" : formatKpiValue(d.kind, s.value)}
                  {isReference(s) && <span className="ml-1.5 text-xs font-medium text-ink-2">(参考値)</span>}
                </p>
                <p className="text-xs text-muted">{s.n}件</p>
              </div>
            );
          })}
        </div>
        <p className="text-sm text-ink-2" data-testid="baseline-count">
          {rows.length}行{estimatedRows > 0 && `(うちメモに「推定」とある行 ${estimatedRows}行)`}
        </p>
        {rows.length > 0 && (
          <div className="max-h-96 overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[820px] text-sm" aria-label="ベースラインの記録">
              <thead className="sticky top-0 bg-surface-2 text-left text-ink-2">
                <tr>
                  <th className="px-3 py-2 font-medium">受付日</th>
                  <th className="px-3 py-2 font-medium">お客様</th>
                  <th className="px-3 py-2 font-medium">品名・図番</th>
                  <th className="px-3 py-2 font-medium">種類</th>
                  <th className="px-3 py-2 font-medium">見積担当</th>
                  <th className="px-3 py-2 text-right font-medium">作業時間(分)</th>
                  <th className="px-3 py-2 font-medium">回答日</th>
                  <th className="px-3 py-2 font-medium">結果</th>
                  <th className="px-3 py-2 font-medium">メモ</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const minutes = baselineRowToRecord(r, i).workMinutes;
                  return (
                    <tr key={`${r.receivedAt}-${i}`} className="border-t border-line">
                      <td className="px-3 py-1.5 tabular-nums">{r.receivedAt}</td>
                      <td className="px-3 py-1.5">{r.customer}</td>
                      <td className="px-3 py-1.5">{r.partName}</td>
                      <td className="px-3 py-1.5">{r.kind ? REQUEST_KIND_LABEL[r.kind] : ""}</td>
                      <td className="px-3 py-1.5">{r.estimator}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{minutes ?? ""}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.answeredAt ?? ""}</td>
                      <td className="px-3 py-1.5">{r.result === "won" ? "受注" : r.result === "lost" ? "失注" : ""}</td>
                      <td className="px-3 py-1.5">{r.memo}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          className="text-accent-ink underline disabled:opacity-50"
                          aria-label={`${r.receivedAt} ${r.partName || r.customer || "この行"}を削除`}
                          disabled={!hydrated}
                          onClick={() => {
                            setRows((cur) => cur.filter((_, j) => j !== i));
                            setDirty(true);
                          }}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonPrimary} disabled={!hydrated || busy || !dirty} onClick={save}>
          {busy ? "保存しています…" : "ベースラインを保存"}
        </button>
        <a className={buttonSecondary} href="/api/impact/export?format=csv&part=baseline">
          保存した内容をCSVで書き出す
        </a>
        {props.origin === "saved" &&
          (confirmDelete ? (
            <>
              <button type="button" className={buttonSecondary} disabled={busy} onClick={remove}>
                本当に削除する
              </button>
              <button type="button" className={buttonSecondary} onClick={() => setConfirmDelete(false)}>
                やめる
              </button>
            </>
          ) : (
            <button type="button" className={buttonSecondary} disabled={!hydrated || busy} onClick={() => setConfirmDelete(true)}>
              保存したベースラインを削除
            </button>
          ))}
        {dirty && <span className="text-sm text-warning">保存していない変更があります</span>}
      </div>
      {message && (
        <p role={message.level === "error" ? "alert" : "status"} className={`text-sm ${message.level === "error" ? "text-critical-ink" : "text-good"}`} data-testid="baseline-message">
          {message.text}
        </p>
      )}
    </div>
  );
}
