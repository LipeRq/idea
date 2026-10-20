"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Company, PastCase, RateTable } from "@/lib/domain/reference";
import type { SimilarCase, Spec } from "@/lib/domain/inquiry";
import type { UnconfirmedField } from "@/lib/extraction/rules";
import { formatHours, formatNumber, formatRate, formatYen } from "@/lib/format";
import { calculateQuote } from "@/lib/quote/calculate";
import type { QuoteInput, QuoteProcessInput, QuoteRef, QuoteResult } from "@/lib/quote/types";
import { quoteWarnings } from "@/lib/quote/warnings";
import { NumberField } from "./NumberField";
import { Notice, StatTile, buttonPrimary, buttonSecondary, inputClass } from "./ui";
import { useHydrated } from "./useHydrated";

type Props = {
  inquiryId: string;
  rates: RateTable;
  company: Company;
  spec: Spec;
  initial: QuoteInput;
  proposal: QuoteInput;
  rationales: { processId: string; rationale: string }[];
  estimateMode: "ai" | "fallback";
  similar: SimilarCase[];
  cases: PastCase[];
  assumptions: string[];
  risks: string[];
  memo: string;
  today: string;
  status: "estimated" | "approved" | "registered" | "extracted";
  /** 抽出結果の要確認・不足の項目(承認するときに確認を求める) */
  unconfirmed: UnconfirmedField[];
};

// 入力欄の上限(APIの検証 QuoteInputSchema と同じ)
const MAX_QUANTITY = 100_000;
const MAX_PRICE_PER_KG = 1_000_000;
const MAX_CHARGE = 100_000;

const SOURCE_LABEL: Record<QuoteProcessInput["source"]["kind"], string> = {
  ai: "AI案",
  fallback: "類似実績から計算",
  human: "人が修正",
};

function refLink(ref: QuoteRef | null): { href: string; label: string }[] {
  if (!ref) return [];
  switch (ref.type) {
    case "material":
      return [{ href: `/rates#material-${ref.id}`, label: "単価表(材料)" }];
    case "treatment":
      return [{ href: `/rates#treatment-${ref.id}`, label: "単価表(外注)" }];
    case "rule":
      return [{ href: "/rates#rules", label: "見積ルール" }];
    case "process":
      return [
        { href: `/rates#process-${ref.id}`, label: "単価表(チャージ)" },
        ...ref.caseIds.map((id) => ({ href: `/cases/${id}`, label: id })),
      ];
  }
}

export function QuoteEditor(props: Props) {
  const router = useRouter();
  const { rates } = props;
  const hydrated = useHydrated();
  const readOnly = props.status === "approved" || props.status === "registered" || !hydrated;
  const approved = props.status === "approved" || props.status === "registered";
  const [input, setInput] = useState<QuoteInput>(props.initial);
  const [saved, setSaved] = useState<QuoteInput>(props.initial);
  // 「案に戻す」で入力欄を作り直すための番号
  const [version, setVersion] = useState(0);
  const [approver, setApprover] = useState(props.company.quoteStaff[0] ?? "見積担当者");
  const [busy, setBusy] = useState<null | "save" | "approve" | "unapprove">(null);
  const [message, setMessage] = useState<{ level: "error" | "ok"; text: string } | null>(null);
  // 正しくない値が入っている入力欄(その間、金額は最後に正しく入力された値で計算している)
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const validity = (label: string) => (invalid: boolean) =>
    setInvalidFields((cur) => {
      if (cur.has(label) === invalid) return cur;
      const next = new Set(cur);
      if (invalid) next.add(label);
      else next.delete(label);
      return next;
    });
  const hasInvalid = invalidFields.size > 0;
  const needsAcknowledge = props.unconfirmed.length > 0;

  const { result, error } = useMemo((): { result: QuoteResult | null; error: string | null } => {
    try {
      return { result: calculateQuote(input, rates), error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : "計算できません" };
    }
  }, [input, rates]);

  const warnings = useMemo(
    () =>
      result
        ? quoteWarnings({
            spec: props.spec,
            input,
            result,
            similar: props.similar,
            cases: props.cases,
            rates,
            company: props.company,
            today: props.today,
            assumptions: props.assumptions,
          })
        : [],
    [result, input, props.spec, props.similar, props.cases, rates, props.company, props.today, props.assumptions],
  );

  const dirty = JSON.stringify(input) !== JSON.stringify(saved);
  const processName = (id: string) => rates.processes.find((p) => p.id === id)?.name ?? id;
  const proposalOf = (id: string) => props.proposal.processes.find((p) => p.processId === id);
  const rationaleOf = (id: string) => props.rationales.find((r) => r.processId === id)?.rationale;

  const removeProcess = (index: number, name: string) => {
    setInput((c) => ({ ...c, processes: c.processes.filter((_, j) => j !== index) }));
    // 外した工程の入力欄の誤りは数えない
    setInvalidFields((cur) => new Set([...cur].filter((label) => !label.startsWith(`${name}の`))));
  };

  const updateProcess = (index: number, patch: Partial<QuoteProcessInput>) =>
    setInput((cur) => ({
      ...cur,
      processes: cur.processes.map((p, i) =>
        i === index ? { ...p, ...patch, source: { ...p.source, kind: "human" as const } } : p,
      ),
    }));

  const save = async (): Promise<boolean> => {
    if (hasInvalid) {
      setMessage({ level: "error", text: "入力に誤りがある欄があります。直してから保存してください" });
      return false;
    }
    const res = await fetch(`/api/inquiries/${props.inquiryId}/quote`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => null);
    if (!res?.ok) {
      setMessage({ level: "error", text: (await res?.json().catch(() => null))?.error ?? "保存に失敗しました" });
      return false;
    }
    setSaved(input);
    return true;
  };

  const onSave = async () => {
    setBusy("save");
    setMessage(null);
    if (await save()) {
      setMessage({ level: "ok", text: "保存しました" });
      router.refresh();
    }
    setBusy(null);
  };

  const onApprove = async () => {
    if (!result) return;
    setBusy("approve");
    setMessage(null);
    if (!(await save())) {
      setBusy(null);
      return;
    }
    const res = await fetch(`/api/inquiries/${props.inquiryId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 画面に出ている金額を送り、サーバーの計算結果と違えば承認しない(単価表が差し替わったときなど)
      body: JSON.stringify({ approver, expectedTotal: result.total, acknowledgeUnconfirmed: acknowledged }),
    }).catch(() => null);
    if (!res?.ok) {
      setMessage({ level: "error", text: (await res?.json().catch(() => null))?.error ?? "承認に失敗しました" });
      setBusy(null);
      return;
    }
    router.push(`/inquiries/${props.inquiryId}/document`);
    setBusy(null);
  };

  const onUnapprove = async () => {
    setBusy("unapprove");
    const res = await fetch(`/api/inquiries/${props.inquiryId}/approve`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setMessage({ level: "error", text: (await res?.json().catch(() => null))?.error ?? "取り消せませんでした" });
      return;
    }
    router.refresh();
  };

  const unusedProcesses = rates.processes.filter((p) => !input.processes.some((x) => x.processId === p.id));
  const surface = rates.treatments.filter((t) => !input.treatments.some((x) => x.treatmentId === t.id));
  const material = rates.materials.find((m) => m.id === input.material.materialId);

  return (
    <div className="space-y-6" key={version}>
      {approved && (
        <Notice level="info">
          {props.status === "registered"
            ? "この見積は承認済みで、CRMに登録済みです。"
            : "この見積は承認済みです。修正するには承認を取り消してください。"}
        </Notice>
      )}

      {result && (
        <section aria-label="見積の合計" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="見積金額(税抜)" value={formatYen(result.total)} note={`${input.quantity}個`} />
          <StatTile label="単価" value={formatYen(result.unitPrice)} note={`利益率 ${formatRate(input.profitRate)}`} />
          <StatTile
            label="1個あたり加工時間"
            value={formatHours(result.hoursPerPiece)}
            note={`数量係数${result.quantityFactor}を適用後。段取り ${formatHours(result.setupHours)}(ロットに1回)`}
          />
          <StatTile
            label="標準リードタイム"
            value={`${result.standardLeadDays}営業日`}
            note={input.expedite ? "特急料金を計上" : "外注日数を含む"}
          />
        </section>
      )}
      {error && <Notice level="critical">{error}</Notice>}
      {hasInvalid && (
        <div role="alert">
          <Notice level="critical">
            入力に誤りがある欄があります({[...invalidFields].join("、")})。金額は最後に正しく入力された値で計算しています。直すまで保存・承認はできません。
          </Notice>
        </div>
      )}
      {!approved && needsAcknowledge && (
        <section aria-labelledby="unconfirmed-heading">
          <Notice level="warning">
            <h2 id="unconfirmed-heading" className="font-semibold">
              抽出結果に未確認の項目が{props.unconfirmed.length}件あります
            </h2>
            <p className="mt-1">見積はこの値(不足の項目は仮の条件)で計算しています。値を確かめてから承認してください。</p>
            <ul className="mt-1 list-disc pl-5" aria-label="未確認の項目">
              {props.unconfirmed.map((f) => (
                <li key={f.key}>
                  {f.label}:{f.reason}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              <Link href={`/inquiries/${props.inquiryId}`} className="underline">
                抽出結果の画面
              </Link>
              で値を修正するか、顧客への確認事項として回答メールで確認します。
            </p>
          </Notice>
        </section>
      )}

      <section className="space-y-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-bold">見積条件</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-sm font-medium">数量(個)</span>
            <NumberField
              label="数量(個)"
              value={input.quantity}
              min={1}
              max={MAX_QUANTITY}
              step="1"
              integer
              disabled={readOnly}
              onValidityChange={validity("数量")}
              onChange={(v) => v !== null && setInput((c) => ({ ...c, quantity: v }))}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">材質</span>
            <select
              className={inputClass}
              value={input.material.materialId}
              disabled={readOnly}
              onChange={(e) => setInput((c) => ({ ...c, material: { ...c.material, materialId: e.target.value } }))}
            >
              {rates.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">材料単価(円/kg、空欄は単価表)</span>
            <NumberField
              label="材料単価(円/kg)"
              value={input.material.pricePerKgOverride}
              allowEmpty
              max={MAX_PRICE_PER_KG}
              placeholder={material ? String(material.pricePerKg) : ""}
              disabled={readOnly}
              onValidityChange={validity("材料単価")}
              onChange={(v) => setInput((c) => ({ ...c, material: { ...c.material, pricePerKgOverride: v && v > 0 ? v : null } }))}
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">利益率(%)</span>
            <NumberField
              label="利益率(%)"
              value={Math.round(input.profitRate * 10_000) / 100}
              max={100}
              disabled={readOnly}
              onValidityChange={validity("利益率")}
              // 0.01%単位(入力した値と計算に使う値がずれないように)
              onChange={(v) => v !== null && setInput((c) => ({ ...c, profitRate: Math.round(v * 100) / 10_000 }))}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={input.expedite}
              disabled={readOnly}
              onChange={(e) => setInput((c) => ({ ...c, expedite: e.target.checked }))}
            />
            特急料金を計上する(加工費+段取り費の{formatRate(rates.rules.expedite.surchargeRate)})
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">表面処理・熱処理:</span>
            {input.treatments.length === 0 && <span className="text-muted">なし</span>}
            {input.treatments.map((t) => (
              <span key={t.treatmentId} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5">
                {rates.treatments.find((x) => x.id === t.treatmentId)?.name}
                {!readOnly && (
                  <button
                    type="button"
                    className="text-xs text-accent-ink hover:underline"
                    aria-label={`${rates.treatments.find((x) => x.id === t.treatmentId)?.name}を外す`}
                    onClick={() => setInput((c) => ({ ...c, treatments: c.treatments.filter((x) => x.treatmentId !== t.treatmentId) }))}
                  >
                    外す
                  </button>
                )}
              </span>
            ))}
            {!readOnly && surface.length > 0 && (
              <select
                aria-label="表面処理・熱処理を追加"
                className="rounded-md border border-line-strong bg-surface px-2 py-1"
                value=""
                onChange={(e) =>
                  e.target.value &&
                  setInput((c) => ({ ...c, treatments: [...c.treatments, { treatmentId: e.target.value, unitPriceOverride: null }] }))
                }
              >
                <option value="">追加…</option>
                {surface.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">工程別の工数</h2>
          <p className="text-sm text-muted">
            案:{props.estimateMode === "ai" ? "AIが類似案件の実績をもとに作成" : "類似案件の実績工数を類似度で加重平均(AI未使用)"}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm" aria-label="工程別の工数">
            <thead className="text-left text-ink-2">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">工程</th>
                <th className="w-28 py-2 pr-3 font-medium">段取り(h)</th>
                <th className="w-28 py-2 pr-3 font-medium">1個あたり(h)</th>
                <th className="w-32 py-2 pr-3 font-medium">チャージ(円/h)</th>
                <th className="py-2 pr-3 font-medium">出典・根拠</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {input.processes.map((p, i) => {
                const name = processName(p.processId);
                const ai = proposalOf(p.processId);
                const rate = rates.processes.find((r) => r.id === p.processId);
                return (
                  <tr key={p.processId} className="border-b border-line align-top last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      <Link href={`/rates#process-${p.processId}`} className="hover:underline">
                        {name}
                      </Link>
                    </th>
                    <td className="py-2 pr-3">
                      <NumberField
                        label={`${name}の段取り時間(時間)`}
                        value={p.setupHours}
                        max={100}
                        disabled={readOnly}
                        onValidityChange={validity(`${name}の段取り時間`)}
                        onChange={(v) => v !== null && updateProcess(i, { setupHours: v })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NumberField
                        label={`${name}の1個あたり加工時間(時間)`}
                        value={p.cycleHoursPerPiece}
                        max={100}
                        disabled={readOnly}
                        onValidityChange={validity(`${name}の1個あたり加工時間`)}
                        onChange={(v) => v !== null && updateProcess(i, { cycleHoursPerPiece: v })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NumberField
                        label={`${name}のチャージ(円/時間)`}
                        value={p.chargeOverride}
                        allowEmpty
                        max={MAX_CHARGE}
                        placeholder={rate ? String(rate.chargePerHour) : ""}
                        disabled={readOnly}
                        onValidityChange={validity(`${name}のチャージ`)}
                        onChange={(v) => updateProcess(i, { chargeOverride: v && v > 0 ? v : null })}
                      />
                    </td>
                    <td className="space-y-1 py-2 pr-3">
                      <p>
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-xs ${p.source.kind === "human" ? "border-warning text-warning" : "border-line text-ink-2"}`}
                        >
                          {SOURCE_LABEL[p.source.kind]}
                        </span>{" "}
                        {p.source.caseIds.map((id) => (
                          <Link key={id} href={`/cases/${id}`} className="mr-2 text-accent-ink hover:underline">
                            {id}
                          </Link>
                        ))}
                      </p>
                      {ai && p.source.kind === "human" && (
                        <p className="text-xs text-muted">
                          案:段取り{formatNumber(ai.setupHours, 2)}h・1個{formatNumber(ai.cycleHoursPerPiece, 2)}h
                        </p>
                      )}
                      {rationaleOf(p.processId) && <p className="text-xs text-ink-2">{rationaleOf(p.processId)}</p>}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      {!readOnly && (
                        <button
                          type="button"
                          className="text-xs text-accent-ink hover:underline"
                          aria-label={`${name}を外す`}
                          onClick={() => removeProcess(i, name)}
                        >
                          外す
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            {unusedProcesses.length > 0 && (
              <select
                aria-label="工程を追加"
                className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm"
                value=""
                onChange={(e) =>
                  e.target.value &&
                  setInput((c) => ({
                    ...c,
                    processes: [
                      ...c.processes,
                      {
                        processId: e.target.value,
                        setupHours: 0.5,
                        cycleHoursPerPiece: 0.1,
                        chargeOverride: null,
                        source: { kind: "human", caseIds: [], note: "人が追加した工程" },
                      },
                    ],
                  }))
                }
              >
                <option value="">工程を追加…</option>
                {unusedProcesses.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => {
                // 工数だけを案に戻す(数量・材質・利益率などの修正は残す)
                setInput((c) => ({ ...c, processes: props.proposal.processes }));
                setInvalidFields((cur) => new Set([...cur].filter((label) => ["数量", "材料単価", "利益率"].includes(label))));
                setVersion((v) => v + 1);
              }}
            >
              工数を案に戻す
            </button>
          </div>
        )}
      </section>

      {result && (
        <section className="space-y-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="text-lg font-bold">見積明細(根拠つき)</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm" aria-label="見積明細">
              <thead className="text-left text-ink-2">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">明細</th>
                  <th className="py-2 pr-3 font-medium">計算式</th>
                  <th className="py-2 pr-3 text-right font-medium">金額</th>
                  <th className="py-2 font-medium">出典</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((l, i) => (
                  <tr key={i} className="border-b border-line align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {l.label}
                      {l.overridden && <span className="ml-1 text-xs text-warning">修正あり</span>}
                    </th>
                    <td className="py-2 pr-3 text-ink-2">{l.basis}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatYen(l.amount)}</td>
                    <td className="py-2 text-xs">
                      {refLink(l.ref).map((r) => (
                        <Link key={r.href} href={r.href} className="mr-2 text-accent-ink hover:underline">
                          {r.label}
                        </Link>
                      ))}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="py-2 pr-3 text-left font-bold">
                    合計(税抜)
                  </th>
                  <td className="py-2 pr-3 text-ink-2">
                    単価 {formatYen(result.unitPrice)} × {result.quantity}個
                  </td>
                  <td className="py-2 pr-3 text-right font-bold tabular-nums" data-testid="quote-total">
                    {formatYen(result.total)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="font-semibold">数量段階別の単価</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="text-sm" aria-label="数量段階別の単価">
                <thead className="text-left text-ink-2">
                  <tr className="border-b border-line">
                    <th className="py-1 pr-6 font-medium">数量</th>
                    <th className="py-1 pr-6 text-right font-medium">単価</th>
                    <th className="py-1 text-right font-medium">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tiers.map((t) => (
                    <tr key={t.quantity} className={t.quantity === result.quantity ? "font-semibold" : ""}>
                      <td className="py-1 pr-6 tabular-nums">{t.quantity}個</td>
                      <td className="py-1 pr-6 text-right tabular-nums">{formatYen(t.unitPrice)}</td>
                      <td className="py-1 text-right tabular-nums">{formatYen(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="warnings-heading">
        <h2 id="warnings-heading" className="text-lg font-bold">
          確認ポイント({warnings.length}件)
        </h2>
        <ul className="space-y-2">
          {warnings.map((w, i) => (
            <li key={i}>
              <Notice level={w.level === "warning" ? "warning" : "info"}>{w.message}</Notice>
            </li>
          ))}
        </ul>
        {(props.memo || props.risks.length > 0) && (
          <div className="space-y-1 text-sm">
            <p className="font-semibold">社内メモ</p>
            <p className="text-ink-2">{props.memo}</p>
            {props.risks.length > 0 && (
              <ul className="list-disc pl-5 text-ink-2">
                {props.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <div className="no-print flex flex-wrap items-center gap-3">
        {!approved ? (
          <>
            <button type="button" className={buttonSecondary} onClick={onSave} disabled={busy !== null || !dirty || !result || hasInvalid}>
              {busy === "save" ? "保存中…" : "修正を保存"}
            </button>
            <label className="flex items-center gap-2 text-sm">
              承認者
              <select className="rounded-md border border-line-strong bg-surface px-2 py-2" value={approver} onChange={(e) => setApprover(e.target.value)}>
                {props.company.quoteStaff.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            {needsAcknowledge && (
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={acknowledged} disabled={!hydrated} onChange={(e) => setAcknowledged(e.target.checked)} />
                未確認の項目({props.unconfirmed.length}件)を確認したうえで承認する
              </label>
            )}
            <button
              type="button"
              className={buttonPrimary}
              onClick={onApprove}
              disabled={busy !== null || !result || !hydrated || hasInvalid || (needsAcknowledge && !acknowledged)}
            >
              {busy === "approve" ? "承認しています…" : "この内容で承認して見積書へ"}
            </button>
            {dirty && <span className="text-sm text-warning">未保存の修正があります</span>}
          </>
        ) : (
          <>
            <Link href={`/inquiries/${props.inquiryId}/document`} className={buttonPrimary}>
              見積書を見る
            </Link>
            {props.status === "approved" && (
              <button type="button" className={buttonSecondary} onClick={onUnapprove} disabled={busy !== null || !hydrated}>
                承認を取り消して修正する
              </button>
            )}
          </>
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
