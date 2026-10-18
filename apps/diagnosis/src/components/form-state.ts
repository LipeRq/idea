import {
  DEFAULT_HOURLY_COST,
  READINESS_IDS,
  TASK_IDS,
  type EMPLOYEE_BANDS,
  type GOALS,
  type INDUSTRIES,
  type ReadinessId,
  type TaskId,
} from "@/lib/diagnosis/master";
import type { DiagnosisInput } from "@/lib/diagnosis/schema";

export type FormState = {
  companyName: string;
  industry: (typeof INDUSTRIES)[number] | "";
  employees: (typeof EMPLOYEE_BANDS)[number] | "";
  goals: (typeof GOALS)[number][];
  challenges: string;
  hourlyCost: string;
  taskHours: Record<TaskId, string>;
  readiness: Partial<Record<ReadinessId, number>>;
};

export const initialFormState: FormState = {
  companyName: "",
  industry: "",
  employees: "",
  goals: [],
  challenges: "",
  hourlyCost: String(DEFAULT_HOURLY_COST),
  taskHours: Object.fromEntries(TASK_IDS.map((id) => [id, ""])) as Record<
    TaskId,
    string
  >,
  readiness: {},
};

export const STEPS = ["会社情報", "業務にかかる時間", "IT環境"] as const;

/** ステップごとの入力チェック。問題があればメッセージを返す */
export function validateStep(step: number, form: FormState): string | null {
  if (step === 0) {
    if (!form.industry) return "業種を選んでください";
    if (!form.employees) return "従業員規模を選んでください";
  }
  if (step === 1) {
    const cost = Number(form.hourlyCost);
    if (!Number.isInteger(cost) || cost < 1_000 || cost > 20_000) {
      return "平均人件費は1,000〜20,000円の整数で入力してください";
    }
    const hours = Object.values(form.taskHours).map(Number);
    if (hours.some((h) => Number.isNaN(h) || h < 0 || h > 10_000)) {
      return "時間は0〜10,000の数字で入力してください";
    }
    if (!hours.some((h) => h > 0)) {
      return "少なくとも1つの業務に時間を入力してください";
    }
  }
  if (step === 2) {
    if (READINESS_IDS.some((id) => form.readiness[id] === undefined)) {
      return "すべての項目に回答してください";
    }
  }
  return null;
}

export function toDiagnosisInput(form: FormState): DiagnosisInput {
  return {
    companyName: form.companyName.trim() || undefined,
    industry: form.industry as DiagnosisInput["industry"],
    employees: form.employees as DiagnosisInput["employees"],
    goals: form.goals,
    challenges: form.challenges.trim() || undefined,
    hourlyCost: Number(form.hourlyCost),
    taskHours: Object.fromEntries(
      Object.entries(form.taskHours)
        .map(([id, v]) => [id, Number(v)] as const)
        .filter(([, h]) => h > 0),
    ),
    readiness: form.readiness as DiagnosisInput["readiness"],
  };
}
