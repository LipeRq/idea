"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonPrimary, buttonSecondary, inputClass } from "../ui";
import { useHydrated } from "../useHydrated";

type Outcome = { result: "won" | "lost"; actualCost: number | null; reworkCount: number | null } | null;

/** 受注・失注、実績原価、手戻りの件数を記録する(効果測定の「受注率」「見積と実績の差」「手戻り」に使う) */
export function OutcomeForm({ inquiryId, initial, orderAmount }: { inquiryId: string; initial: Outcome; orderAmount: number }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [result, setResult] = useState<"" | "won" | "lost">(initial?.result ?? "");
  const [actualCost, setActualCost] = useState(initial?.actualCost?.toString() ?? "");
  const [rework, setRework] = useState(initial?.reworkCount?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ level: "info" | "error"; text: string } | null>(null);

  const parse = (v: string, label: string): number | null | "error" => {
    if (v.trim() === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) {
      setMessage({ level: "error", text: `${label}は0以上の整数で入力してください` });
      return "error";
    }
    return n;
  };

  const save = async () => {
    if (result === "") {
      setMessage({ level: "error", text: "受注か失注かを選んでください" });
      return;
    }
    const cost = result === "won" ? parse(actualCost, "実績原価") : null;
    const rw = result === "won" ? parse(rework, "手戻り件数") : null;
    if (cost === "error" || rw === "error") return;
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/inquiries/${inquiryId}/outcome`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result, actualCost: cost, reworkCount: rw }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setMessage({ level: "error", text: (await res?.json().catch(() => null))?.error ?? "記録に失敗しました" });
      return;
    }
    setMessage({ level: "info", text: "結果を記録しました。効果測定ダッシュボードに反映されます。" });
    router.refresh();
  };

  const clear = async () => {
    setBusy(true);
    const res = await fetch(`/api/inquiries/${inquiryId}/outcome`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setMessage({ level: "error", text: "記録を消せませんでした" });
      return;
    }
    setResult("");
    setActualCost("");
    setRework("");
    setMessage({ level: "info", text: "結果の記録を消しました。" });
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">
        受注・失注が決まったとき、製作が終わって実績原価が分かったときに記録します。効果測定ダッシュボードの「見積受注率」「見積と実績の差」「受注後の手戻り」に使います(受注・失注の正本はSalesforceなど、ここは効果測定のための控えです)。
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">結果</span>
          <select className={inputClass} value={result} disabled={!hydrated} onChange={(e) => setResult(e.target.value as "" | "won" | "lost")}>
            <option value="">未定</option>
            <option value="won">受注</option>
            <option value="lost">失注</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">実績原価(円・税抜)</span>
          <input
            type="number"
            min="0"
            step="1"
            className={inputClass}
            value={actualCost}
            disabled={!hydrated || result !== "won"}
            onChange={(e) => setActualCost(e.target.value)}
            placeholder={`受注額 ${orderAmount.toLocaleString("ja-JP")}円`}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">受注後の手戻り件数</span>
          <input type="number" min="0" step="1" className={inputClass} value={rework} disabled={!hydrated || result !== "won"} onChange={(e) => setRework(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonPrimary} disabled={!hydrated || busy} onClick={save}>
          {busy ? "記録しています…" : "結果を記録"}
        </button>
        {initial && (
          <button type="button" className={buttonSecondary} disabled={!hydrated || busy} onClick={clear}>
            記録を消す
          </button>
        )}
        {message && (
          <p role={message.level === "error" ? "alert" : "status"} className={`text-sm ${message.level === "error" ? "text-critical-ink" : "text-good"}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
