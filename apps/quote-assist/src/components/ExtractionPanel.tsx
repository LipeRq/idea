"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  FIELD_LABEL,
  type ExtractedField,
  type FieldKey,
  type Question,
  type Spec,
} from "@/lib/domain/inquiry";
import { PROCESS_TYPE_LABEL, PROCESS_TYPES, SHAPE_LABEL, SHAPES, type Dimensions } from "@/lib/domain/reference";
import type { ExtractionEdits } from "@/lib/extraction/edit";
import { CopyButton } from "./CopyButton";
import { ConfidenceBadge, FieldStatusBadge, buttonPrimary, buttonSecondary, inputClass } from "./ui";
import { useHydrated } from "./useHydrated";

type Option = { id: string; name: string };

type Props = {
  inquiryId: string;
  fields: ExtractedField[];
  spec: Spec;
  questions: Question[];
  questionEmail: string;
  drawings: { id: string; fileName: string }[];
  materials: Option[];
  surfaceTreatments: Option[];
  heatTreatments: Option[];
  editable: boolean;
  estimated: boolean;
};

type FormState = {
  customerName: string;
  partName: string;
  drawingNumber: string;
  revision: string;
  material: string;
  quantity: string;
  shape: Dimensions["shape"];
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  diameterMm: string;
  tolerance: string;
  surfaceTreatment: string;
  heatTreatment: string;
  dueDate: string;
  inspection: string;
  processType: string;
};

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));
// 表面処理・熱処理の選択肢:"" は記載なし(要確認)、"none" はなし
const treatmentValue = (v: string | null) => v ?? "";

function toForm(spec: Spec): FormState {
  const d = spec.dimensions;
  return {
    customerName: str(spec.customerName),
    partName: str(spec.partName),
    drawingNumber: str(spec.drawingNumber),
    revision: str(spec.revision),
    material: str(spec.materialId),
    quantity: str(spec.quantity),
    shape: d?.shape ?? "block",
    lengthMm: str(d?.lengthMm),
    widthMm: str(d?.widthMm),
    heightMm: str(d?.heightMm),
    diameterMm: str(d?.diameterMm),
    tolerance: str(spec.toleranceMm),
    surfaceTreatment: treatmentValue(spec.surfaceTreatmentId),
    heatTreatment: treatmentValue(spec.heatTreatmentId),
    dueDate: str(spec.dueDate),
    inspection: str(spec.inspection),
    processType: str(spec.processType),
  };
}

const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** 変更した項目だけを送る */
function diffEdits(before: FormState, after: FormState): { edits: ExtractionEdits; error: string | null } {
  const edits: ExtractionEdits = {};
  const text = (k: "customerName" | "partName" | "drawingNumber" | "revision" | "inspection") => {
    if (before[k] !== after[k]) edits[k] = after[k].trim() || null;
  };
  text("customerName");
  text("partName");
  text("drawingNumber");
  text("revision");
  text("inspection");
  if (before.material !== after.material) edits.material = after.material || null;
  if (before.quantity !== after.quantity) {
    const q = num(after.quantity);
    if (q !== null && (!Number.isInteger(q) || q < 1)) return { edits, error: "数量は1以上の整数で入力してください" };
    edits.quantity = q;
  }
  const dimKeys = ["shape", "lengthMm", "widthMm", "heightMm", "diameterMm"] as const;
  if (dimKeys.some((k) => before[k] !== after[k])) {
    const round = after.shape === "round";
    const values = round ? [after.lengthMm, after.diameterMm] : [after.lengthMm, after.widthMm, after.heightMm];
    if (values.every((v) => v.trim() === "")) {
      edits.dimensions = null;
    } else {
      if (values.some((v) => !(Number(v) > 0))) return { edits, error: "寸法は0より大きい数で入力してください" };
      edits.dimensions = {
        shape: after.shape,
        lengthMm: Number(after.lengthMm),
        widthMm: round ? null : Number(after.widthMm),
        heightMm: round ? null : Number(after.heightMm),
        diameterMm: round ? Number(after.diameterMm) : null,
      };
    }
  }
  if (before.tolerance !== after.tolerance) {
    const t = num(after.tolerance);
    if (t !== null && !(t > 0)) return { edits, error: "公差は0より大きい数で入力してください(普通公差のみなら空欄)" };
    edits.tolerance = t;
  }
  if (before.surfaceTreatment !== after.surfaceTreatment) edits.surfaceTreatment = after.surfaceTreatment || null;
  if (before.heatTreatment !== after.heatTreatment) edits.heatTreatment = after.heatTreatment || null;
  if (before.dueDate !== after.dueDate) edits.dueDate = after.dueDate || null;
  if (before.processType !== after.processType) {
    edits.processType = (after.processType || null) as ExtractionEdits["processType"];
  }
  return { edits, error: null };
}

export function ExtractionPanel(props: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => toForm(props.spec));
  const [busy, setBusy] = useState<null | "save" | "estimate">(null);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();
  const drawingByName = new Map(props.drawings.map((d) => [d.fileName, d.id]));
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const { edits, error: invalid } = diffEdits(toForm(props.spec), form);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (Object.keys(edits).length === 0) {
      setEditing(false);
      return;
    }
    if (props.estimated && !window.confirm("抽出内容を変えると、類似案件の検索と見積をやり直します。よろしいですか?")) return;
    setBusy("save");
    setError(null);
    const res = await fetch(`/api/inquiries/${props.inquiryId}/extraction`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edits),
    }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setError((await res?.json().catch(() => null))?.error ?? "保存に失敗しました");
      return;
    }
    setEditing(false);
    router.refresh();
  };

  const estimate = async () => {
    setBusy("estimate");
    setError(null);
    const res = await fetch(`/api/inquiries/${props.inquiryId}/estimate`, { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setBusy(null);
      setError((await res?.json().catch(() => null))?.error ?? "類似案件の検索に失敗しました");
      return;
    }
    router.push(`/inquiries/${props.inquiryId}/similar`);
    setBusy(null);
  };

  const sourceLabel = (s: ExtractedField["sources"][number]) => {
    const drawingId = drawingByName.get(s.document);
    const doc = `${s.document}${s.page ? ` p.${s.page}` : ""}`;
    return (
      <>
        {drawingId ? (
          <a
            href={`/api/inquiries/${props.inquiryId}/drawings/${drawingId}${s.page ? `#page=${s.page}` : ""}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent-ink hover:underline"
          >
            {doc}
          </a>
        ) : (
          <span>{doc}</span>
        )}{" "}
        {s.location}
        {s.quote && <span className="text-ink-2">「{s.quote}」</span>}
      </>
    );
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">抽出結果</h2>
          {props.editable && !editing && (
            <button type="button" className={buttonSecondary} onClick={() => setEditing(true)} disabled={!hydrated}>
              抽出内容を修正する
            </button>
          )}
        </div>

        {!editing ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" aria-label="抽出結果">
              <thead className="text-left text-ink-2">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">項目</th>
                  <th className="py-2 pr-3 font-medium">値</th>
                  <th className="py-2 pr-3 font-medium">状態</th>
                  <th className="py-2 pr-3 font-medium">根拠(図面・メールの位置)</th>
                </tr>
              </thead>
              <tbody>
                {props.fields.map((f) => (
                  <tr key={f.key} className="border-b border-line align-top last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium whitespace-nowrap">
                      {FIELD_LABEL[f.key]}
                      {f.required && <span className="ml-1 text-xs text-muted">必須</span>}
                    </th>
                    <td className="py-2 pr-3">
                      <span className="font-semibold">{f.display || "—"}</span>
                      {f.raw && f.raw !== f.display && <span className="block text-xs text-muted">表記:{f.raw}</span>}
                    </td>
                    <td className="space-y-1 py-2 pr-3">
                      <FieldStatusBadge status={f.status} />{" "}
                      {f.editedByHuman ? (
                        <span className="inline-block rounded-full border border-line px-2 py-0.5 text-xs text-ink-2">人が修正</span>
                      ) : (
                        <ConfidenceBadge value={f.confidence} />
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <ul className="space-y-1">
                        {f.sources.map((s, i) => (
                          <li key={i}>{sourceLabel(s)}</li>
                        ))}
                      </ul>
                      {(f.issue || f.note) && (
                        <p className={`mt-1 text-xs ${f.issue ? "text-warning" : "text-muted"}`}>{f.issue ?? f.note}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EditForm form={form} set={set} options={props} />
        )}

        {editing && (
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonPrimary} onClick={save} disabled={busy !== null}>
              {busy === "save" ? "保存中…" : "保存して再チェック"}
            </button>
            <button
              type="button"
              className={buttonSecondary}
              onClick={() => {
                setForm(toForm(props.spec));
                setEditing(false);
                setError(null);
              }}
            >
              やめる
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-critical-ink">
            {error}
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="questions-heading">
        <h2 id="questions-heading" className="text-lg font-bold">
          顧客への確認事項({props.questions.length}件)
        </h2>
        {props.questions.length === 0 ? (
          <p className="text-sm text-ink-2">見積に必要な項目はそろっています。</p>
        ) : (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {props.questions.map((q, i) => (
                <li key={i}>
                  <p className="font-medium">{q.question}</p>
                  <p className="text-xs text-muted">
                    {q.field !== "other" ? `${FIELD_LABEL[q.field as FieldKey]}:` : ""}
                    {q.issue}({q.origin === "ai" ? "AIの文案" : "定型文"})
                  </p>
                </li>
              ))}
            </ol>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="question-email" className="text-sm font-semibold">
                  確認メールの案(送信は担当者が行います)
                </label>
                <CopyButton text={props.questionEmail} />
              </div>
              <textarea id="question-email" readOnly value={props.questionEmail} className={`${inputClass} min-h-64 font-mono text-sm`} />
            </div>
          </>
        )}
      </section>

      {props.editable && (
        <div className="no-print flex flex-wrap items-center gap-4">
          <button type="button" className={buttonPrimary} onClick={estimate} disabled={busy !== null || editing || !hydrated}>
            {busy === "estimate" ? "検索しています…" : props.estimated ? "類似案件を検索し直す" : "類似案件を検索して工数案を作る"}
          </button>
          {busy === "estimate" && (
            <p role="status" className="text-sm text-ink-2">
              過去案件から似た案件を探し、工数案を作っています。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EditForm({
  form,
  set,
  options,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  options: Pick<Props, "materials" | "surfaceTreatments" | "heatTreatments">;
}) {
  const text = (k: keyof FormState, label: string, type = "text", extra: Record<string, string> = {}) => (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input className={inputClass} type={type} value={form[k]} onChange={(e) => set(k, e.target.value as never)} {...extra} />
    </label>
  );
  const select = (k: keyof FormState, label: string, items: { value: string; label: string }[]) => (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <select className={inputClass} value={form[k]} onChange={(e) => set(k, e.target.value as never)}>
        {items.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
      </select>
    </label>
  );
  const treatmentItems = (list: Option[]) => [
    { value: "", label: "記載なし(要確認)" },
    { value: "none", label: "なし" },
    ...list.map((t) => ({ value: t.id, label: t.name })),
  ];
  const round = form.shape === "round";
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {text("customerName", "顧客")}
      {text("partName", "品名")}
      {text("drawingNumber", "図番")}
      {text("revision", "版")}
      {select("material", "材質", [{ value: "", label: "未確定" }, ...options.materials.map((m) => ({ value: m.id, label: m.name }))])}
      {text("quantity", "数量(個)", "number", { min: "1", step: "1", inputMode: "numeric" })}
      {select("shape", "形状", SHAPES.map((s) => ({ value: s, label: SHAPE_LABEL[s] })))}
      {text("lengthMm", "長さ(mm)", "number", { min: "0", step: "any" })}
      {round ? text("diameterMm", "直径(mm)", "number", { min: "0", step: "any" }) : text("widthMm", "幅(mm)", "number", { min: "0", step: "any" })}
      {!round && text("heightMm", "厚さ・高さ(mm)", "number", { min: "0", step: "any" })}
      {text("tolerance", "最小公差 ±(mm、普通公差のみなら空欄)", "number", { min: "0", step: "any" })}
      {select("surfaceTreatment", "表面処理", treatmentItems(options.surfaceTreatments))}
      {select("heatTreatment", "熱処理", treatmentItems(options.heatTreatments))}
      {text("dueDate", "希望納期", "date")}
      {text("inspection", "検査書類")}
      {select("processType", "加工種別", [{ value: "", label: "未確定" }, ...PROCESS_TYPES.map((p) => ({ value: p, label: PROCESS_TYPE_LABEL[p] }))])}
    </div>
  );
}
