import { MATERIAL_GROUP_LABEL, type Company, type RateTable } from "../domain/reference";
import {
  FIELD_KEYS,
  FIELD_LABEL,
  type ExtractedField,
  type FieldKey,
  type Question,
  type Spec,
} from "../domain/inquiry";
import { formatJpDate } from "../dates";

// 必須項目と矛盾のチェック、顧客への確認事項の作成。判定はすべてルールで行い、
// AIの質問文があればそれを使い、なければ定型文で補う。

/** 見積の前に必ず確定させる項目。表面処理・熱処理・検査書類は「なし」と明記されていればよい */
export const REQUIRED_FIELDS: readonly FieldKey[] = [
  "customerName",
  "partName",
  "drawingNumber",
  "material",
  "quantity",
  "dimensions",
  "surfaceTreatment",
  "heatTreatment",
  "dueDate",
  "inspection",
];

const TEMPLATE_QUESTION: Partial<Record<FieldKey, (spec: Spec) => string>> = {
  customerName: () => "御社名とご担当者様のお名前をお知らせください。",
  partName: () => "品名をお知らせください。",
  drawingNumber: () => "図番と版をお知らせください。",
  material: (s) =>
    s.materialCandidates.length > 0
      ? `材質のご指定(${s.materialCandidates.join("・")}など)をお知らせください。`
      : "材質のご指定をお知らせください。",
  quantity: () => "ご依頼数量をお知らせください。数量によって単価が変わるため、複数の数量でのお見積りも可能です。",
  dimensions: () => "外形寸法が読み取れませんでした。寸法の入った図面をお送りいただけますでしょうか。",
  surfaceTreatment: () => "表面処理の要否と、必要な場合は処理の種類(膜厚・色など)をお知らせください。",
  heatTreatment: () => "熱処理の要否と、必要な場合は種類と硬さのご指定をお知らせください。",
  dueDate: () => "ご希望の納期をお知らせください。",
  inspection: () => "検査成績書やミルシートなど、ご提出が必要な書類はございますか。",
};

function hasValue(key: FieldKey, spec: Spec): boolean {
  switch (key) {
    case "customerName":
      return spec.customerName !== null;
    case "material":
      return spec.materialId !== null;
    case "tolerance":
      return true; // 個別公差がなければ普通公差として扱う
    case "surfaceTreatment":
      return spec.surfaceTreatmentId !== null;
    case "heatTreatment":
      return spec.heatTreatmentId !== null;
    default:
      return spec[key] !== null;
  }
}

/** ルールで見つかる問題(AIの読み取りとは別に、値どうしの関係から判定する) */
function ruleIssues(spec: Spec, rates: RateTable, today: string): Partial<Record<FieldKey, string>> {
  const issues: Partial<Record<FieldKey, string>> = {};
  if (spec.dueDate && spec.dueDate < today) {
    issues.dueDate = `希望納期(${formatJpDate(spec.dueDate)})が受付日より前です`;
  }
  const material = rates.materials.find((m) => m.id === spec.materialId);
  if (material) {
    for (const k of ["surfaceTreatment", "heatTreatment"] as const) {
      const id = k === "surfaceTreatment" ? spec.surfaceTreatmentId : spec.heatTreatmentId;
      const t = rates.treatments.find((x) => x.id === id);
      if (t && !t.materialGroups.includes(material.group)) {
        issues[k] = `${t.name}は${MATERIAL_GROUP_LABEL[material.group]}(${material.name})には通常行いません`;
      }
    }
  }
  if (spec.dimensions && spec.processType === "turning" && spec.dimensions.shape !== "round") {
    issues.processType = "旋削と判定されていますが、外形が丸物ではありません";
  }
  return issues;
}

type FieldInput = Omit<ExtractedField, "status" | "required" | "editedByHuman"> & {
  editedByHuman?: boolean;
};

export function applyRules(
  spec: Spec,
  drafts: FieldInput[],
  aiQuestions: Question[],
  ctx: { rates: RateTable; today: string },
): { fields: ExtractedField[]; questions: Question[] } {
  const extra = ruleIssues(spec, ctx.rates, ctx.today);
  const fields: ExtractedField[] = drafts.map((d) => {
    const required = REQUIRED_FIELDS.includes(d.key);
    const edited = d.editedByHuman ?? false;
    // 人が修正した項目は、正規化のときの問題(あいまいな材質名など)を引き継がない
    const issue = extra[d.key] ?? (edited ? null : d.issue);
    const present = hasValue(d.key, spec);
    let status: ExtractedField["status"] = "ok";
    if (!present && required) status = "missing";
    else if (issue || (!edited && d.confidence === "low")) status = "review";
    return { ...d, issue, required, editedByHuman: edited, status };
  });

  const questions: Question[] = [];
  for (const key of FIELD_KEYS) {
    const f = fields.find((x) => x.key === key)!;
    // 顧客に聞くのは、必須項目が欠けているときと、値そのものに問題があるとき。
    // 確信度が低いだけ(読み取りの不安)は社内での確認にとどめる
    const needsCustomer = f.status === "missing" || (f.issue !== null && !f.editedByHuman);
    if (!needsCustomer) continue;
    const ai = f.editedByHuman ? undefined : aiQuestions.find((q) => q.field === key);
    const template = TEMPLATE_QUESTION[key]?.(spec);
    if (!ai && !template) continue;
    questions.push(
      ai ?? {
        field: key,
        issue: f.issue ?? `${FIELD_LABEL[key]}が図面・メールに書かれていません`,
        question: template!,
        origin: "rule",
      },
    );
  }
  for (const q of aiQuestions) {
    if (q.field === "other") questions.push(q);
  }
  return { fields, questions };
}

/** 顧客への確認メールの案(送信は人が行う) */
export function buildQuestionEmail(spec: Spec, questions: Question[], company: Company): string {
  const to = [spec.customerName ?? "ご担当者", spec.contactName ? `${spec.contactName}様` : "様"].join(" ");
  const part = [spec.partName, spec.drawingNumber && `${spec.drawingNumber}${spec.revision ? ` Rev.${spec.revision}` : ""}`]
    .filter(Boolean)
    .join("(") + (spec.partName && spec.drawingNumber ? ")" : "");
  const lines = questions.map((q, i) => `${i + 1}. ${q.question}`);
  return `${to}

いつもお世話になっております。${company.name}の${company.salesContact.split(" ").pop()}です。
${part || "ご依頼の部品"}のお見積りにあたり、下記の点をご確認いただけますでしょうか。

${lines.join("\n")}

ご回答をいただき次第、お見積りをお送りいたします。
よろしくお願いいたします。

${company.name} ${company.salesContact}`;
}

