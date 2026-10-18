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

/** 入力エラー。fields は問題のある入力欄のID(aria-invalid と aria-describedby を付ける) */
export type StepError = { message: string; fields: string[] };

export const hoursFieldId = (taskId: TaskId) => `hours-${taskId}`;
export const readinessFieldId = (id: ReadinessId) => `readiness-${id}`;

/** ステップごとの入力チェック。問題があればメッセージと該当する欄を返す */
export function validateStep(step: number, form: FormState): StepError | null {
  if (step === 0) {
    if (!form.industry) return { message: "業種を選んでください", fields: ["industry"] };
    if (!form.employees) return { message: "従業員規模を選んでください", fields: ["employees"] };
  }
  if (step === 1) {
    const cost = Number(form.hourlyCost);
    if (!Number.isInteger(cost) || cost < 1_000 || cost > 20_000) {
      return {
        message: "平均人件費は1,000〜20,000円の整数で入力してください",
        fields: ["hourlyCost"],
      };
    }
    const hours = TASK_IDS.map((id) => [id, Number(form.taskHours[id])] as const);
    const outOfRange = hours.filter(([, h]) => Number.isNaN(h) || h < 0 || h > 10_000);
    if (outOfRange.length > 0) {
      return {
        message: "時間は0〜10,000の数字で入力してください",
        fields: outOfRange.map(([id]) => hoursFieldId(id)),
      };
    }
    if (!hours.some(([, h]) => h > 0)) {
      return {
        message: "少なくとも1つの業務に時間を入力してください",
        fields: TASK_IDS.map(hoursFieldId),
      };
    }
  }
  if (step === 2) {
    const unanswered = READINESS_IDS.filter((id) => form.readiness[id] === undefined);
    if (unanswered.length > 0) {
      return {
        message: "すべての項目に回答してください",
        fields: unanswered.map(readinessFieldId),
      };
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
