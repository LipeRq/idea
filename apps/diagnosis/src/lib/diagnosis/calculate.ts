import {
  COST_BY_DIFFICULTY,
  DIFFICULTY_PENALTY,
  READINESS_QUESTIONS,
  TASKS,
  TOP_RECOMMENDATIONS,
  type Difficulty,
  type ReadinessId,
  type TaskId,
} from "./master";
import type { DiagnosisInput } from "./schema";

export type ReadinessLevel = "preparation" | "ready" | "advanced";

export const READINESS_LEVEL_LABEL: Record<ReadinessLevel, string> = {
  preparation: "準備段階",
  ready: "導入可能",
  advanced: "推進段階",
};

export type ReadinessResult = {
  score: number;
  level: ReadinessLevel;
  breakdown: {
    id: ReadinessId;
    label: string;
    answer: string;
    points: number;
    weightedScore: number;
    weight: number;
  }[];
};

export type TaskResult = {
  taskId: TaskId;
  name: string;
  monthlyHours: number;
  automationRate: number;
  difficulty: Difficulty;
  /** 前提条件が整っておらず難易度を引き上げたか */
  prerequisiteGap: boolean;
  monthlySavedHours: number;
  annualSavedHours: number;
  annualSavedAmount: number;
  priorityScore: number;
  initialCost: number;
  monthlyCost: number;
  /** 投資回収までの月数。月の削減額が運用費を下回る場合は null */
  paybackMonths: number | null;
};

export type DiagnosisResult = {
  readiness: ReadinessResult;
  /** 準備度に応じて、試算上の削減効果をどれだけ実現できるかの係数(0.5〜1.0) */
  realizationFactor: number;
  tasks: TaskResult[];
  top: TaskResult[];
  totals: {
    monthlyHours: number;
    annualSavedHours: number;
    annualSavedAmount: number;
    topAnnualSavedAmount: number;
    topInitialCost: number;
    topAnnualRunningCost: number;
  };
};

export function calculateReadiness(
  answers: DiagnosisInput["readiness"],
): ReadinessResult {
  const breakdown = READINESS_QUESTIONS.map((q) => {
    const points = answers[q.id];
    return {
      id: q.id,
      label: q.label,
      answer: q.options[points],
      points,
      weight: q.weight,
      weightedScore: (q.weight * points) / 3,
    };
  });
  const score = Math.round(
    breakdown.reduce((sum, b) => sum + b.weightedScore, 0),
  );
  const level: ReadinessLevel =
    score >= 70 ? "advanced" : score >= 40 ? "ready" : "preparation";
  return { score, level, breakdown };
}

export function realizationFactorFor(readinessScore: number): number {
  return 0.5 + 0.5 * (readinessScore / 100);
}

export function calculateDiagnosis(input: DiagnosisInput): DiagnosisResult {
  const readiness = calculateReadiness(input.readiness);
  const realizationFactor = realizationFactorFor(readiness.score);

  const tasks = TASKS.flatMap((task): TaskResult[] => {
    const monthlyHours = input.taskHours[task.id] ?? 0;
    if (monthlyHours <= 0) return [];

    const prerequisite: ReadinessId | undefined =
      "prerequisite" in task ? task.prerequisite : undefined;
    const prerequisiteGap =
      prerequisite !== undefined && input.readiness[prerequisite] <= 1;
    const difficulty = Math.min(
      3,
      task.difficulty + (prerequisiteGap ? 1 : 0),
    ) as Difficulty;

    const monthlySavedHours =
      monthlyHours * task.automationRate * realizationFactor;
    const monthlySavedAmount = monthlySavedHours * input.hourlyCost;
    const annualSavedAmount = monthlySavedAmount * 12;
    const { initial, monthly } = COST_BY_DIFFICULTY[difficulty];
    const netMonthly = monthlySavedAmount - monthly;

    return [
      {
        taskId: task.id,
        name: task.name,
        monthlyHours,
        automationRate: task.automationRate,
        difficulty,
        prerequisiteGap,
        monthlySavedHours: round1(monthlySavedHours),
        annualSavedHours: round1(monthlySavedHours * 12),
        annualSavedAmount: Math.round(annualSavedAmount),
        priorityScore: Math.round(
          annualSavedAmount / DIFFICULTY_PENALTY[difficulty],
        ),
        initialCost: initial,
        monthlyCost: monthly,
        paybackMonths: netMonthly > 0 ? Math.ceil(initial / netMonthly) : null,
      },
    ];
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  const top = tasks.slice(0, TOP_RECOMMENDATIONS);
  const sum = (items: TaskResult[], pick: (t: TaskResult) => number) =>
    items.reduce((acc, t) => acc + pick(t), 0);

  return {
    readiness,
    // 準備度は整数なので係数は小数第3位までで割り切れる(計算に使った値をそのまま表示する)
    realizationFactor: Math.round(realizationFactor * 1000) / 1000,
    tasks,
    top,
    totals: {
      monthlyHours: round1(sum(tasks, (t) => t.monthlyHours)),
      annualSavedHours: round1(sum(tasks, (t) => t.annualSavedHours)),
      annualSavedAmount: sum(tasks, (t) => t.annualSavedAmount),
      topAnnualSavedAmount: sum(top, (t) => t.annualSavedAmount),
      topInitialCost: sum(top, (t) => t.initialCost),
      topAnnualRunningCost: sum(top, (t) => t.monthlyCost * 12),
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
