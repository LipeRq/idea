"use client";

import {
  EMPLOYEE_BANDS,
  GOALS,
  INDUSTRIES,
  READINESS_QUESTIONS,
  TASKS,
} from "@/lib/diagnosis/master";
import { PRIVACY_POLICY_URL } from "@/lib/site";
import {
  STEPS,
  hoursFieldId,
  readinessFieldId,
  type FormState,
} from "./form-state";

type Props = {
  step: number;
  form: FormState;
  onChange: (update: (prev: FormState) => FormState) => void;
  /** 入力エラーのある欄のID */
  invalid: ReadonlySet<string>;
};

/** フォーム下部に出すエラーメッセージのID。エラーのある欄から aria-describedby で参照する */
export const FORM_ERROR_ID = "diagnosis-form-error";

/** 「いま困っていること」の欄と、外部のAIへの送信の注記のID(注記は欄から aria-describedby で参照する) */
const CHALLENGES_ID = "diagnosis-challenges";
const CHALLENGES_NOTE_ID = "diagnosis-challenges-note";

export const inputClass =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-base text-ink focus:outline-2 focus:outline-accent aria-[invalid=true]:border-critical";

/** エラーのある欄に付ける属性 */
function invalidProps(invalid: boolean) {
  return invalid ? { "aria-invalid": true as const, "aria-describedby": FORM_ERROR_ID } : {};
}

export function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="flex gap-2 text-sm" aria-label="入力ステップ">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === step ? "step" : undefined}
          className={`flex-1 border-t-4 pt-2 ${
            i <= step ? "border-accent text-ink" : "border-grid text-muted"
          }`}
        >
          <span className="font-semibold">{i + 1}</span> {label}
        </li>
      ))}
    </ol>
  );
}

export function DiagnosisForm({ step, ...props }: Props) {
  if (step === 0) return <CompanyStep {...props} />;
  if (step === 1) return <HoursStep {...props} />;
  return <ReadinessStep {...props} />;
}

type StepProps = Omit<Props, "step">;

function CompanyStep({ form, onChange, invalid }: StepProps) {
  return (
    <div className="space-y-6">
      <label className="block space-y-1">
        <span className="font-medium">会社名(任意)</span>
        <input
          className={inputClass}
          value={form.companyName}
          maxLength={100}
          onChange={(e) =>
            onChange((p) => ({ ...p, companyName: e.target.value }))
          }
        />
      </label>

      <div className="grid gap-6 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="font-medium">業種</span>
          <select
            className={inputClass}
            {...invalidProps(invalid.has("industry"))}
            value={form.industry}
            onChange={(e) =>
              onChange((p) => ({
                ...p,
                industry: e.target.value as FormState["industry"],
              }))
            }
          >
            <option value="">選択してください</option>
            {INDUSTRIES.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="font-medium">従業員規模</span>
          <select
            className={inputClass}
            {...invalidProps(invalid.has("employees"))}
            value={form.employees}
            onChange={(e) =>
              onChange((p) => ({
                ...p,
                employees: e.target.value as FormState["employees"],
              }))
            }
          >
            <option value="">選択してください</option>
            {EMPLOYEE_BANDS.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium">AIで優先したいこと(複数選択可)</legend>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((goal) => {
            const checked = form.goals.includes(goal);
            return (
              <label
                key={goal}
                // チェックボックス本体は非表示なので、キーボード操作時のフォーカスはラベル側に出す
                className={`cursor-pointer rounded-full border px-4 py-1.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent ${
                  checked
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-line bg-surface text-ink-2"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() =>
                    onChange((p) => ({
                      ...p,
                      goals: checked
                        ? p.goals.filter((g) => g !== goal)
                        : [...p.goals, goal],
                    }))
                  }
                />
                {goal}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor={CHALLENGES_ID} className="block font-medium">
          いま困っていること(任意)
        </label>
        {/* 自由記述は外部のAI(Anthropic、米国)に送るため、書く前に目に入る位置に注意を出す */}
        <p id={CHALLENGES_NOTE_ID} className="text-sm text-ink-2">
          入力内容は、AIによる分析のため Anthropic 社(米国)に送信します。
          <strong className="font-semibold text-ink">
            個人情報(氏名・連絡先など)や機密情報は書かないでください。
          </strong>
          {PRIVACY_POLICY_URL && (
            <>
              詳しくは
              <a
                href={PRIVACY_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-ink underline"
              >
                プライバシーポリシー(別タブで開きます)
              </a>
              をご覧ください。
            </>
          )}
        </p>
        <textarea
          id={CHALLENGES_ID}
          aria-describedby={CHALLENGES_NOTE_ID}
          className={`${inputClass} min-h-28`}
          maxLength={1000}
          placeholder="例:見積の作成がベテラン1人に集中していて、受注を取りこぼしている"
          value={form.challenges}
          onChange={(e) =>
            onChange((p) => ({ ...p, challenges: e.target.value }))
          }
        />
      </div>
    </div>
  );
}

function HoursStep({ form, onChange, invalid }: StepProps) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-2">
        各業務に<strong>全員分の合計で月に何時間</strong>
        かかっているかを、おおよそで入力してください。該当しない業務は空欄で構いません。
        <br />
        目安:5人が毎日30分 → 月約50時間
      </p>

      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {TASKS.map((task) => (
          <li
            key={task.id}
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <label htmlFor={hoursFieldId(task.id)} className="space-y-0.5">
              <span className="block font-medium">{task.name}</span>
              <span className="block text-sm text-muted">{task.examples}</span>
            </label>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm text-ink-2">月</span>
              <input
                id={hoursFieldId(task.id)}
                {...invalidProps(invalid.has(hoursFieldId(task.id)))}
                type="number"
                inputMode="numeric"
                min={0}
                max={10000}
                className={`${inputClass} w-28 text-right tabular-nums`}
                value={form.taskHours[task.id]}
                onChange={(e) =>
                  onChange((p) => ({
                    ...p,
                    taskHours: { ...p.taskHours, [task.id]: e.target.value },
                  }))
                }
              />
              <span className="text-sm text-ink-2">時間</span>
            </div>
          </li>
        ))}
      </ul>

      <label className="block max-w-sm space-y-1">
        <span className="font-medium">平均人件費(1時間あたり)</span>
        <span className="block text-sm text-muted">
          月給30万円の社員なら、社会保険料などを含めて約2,500〜3,000円が目安です。
        </span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1000}
            max={20000}
            step={100}
            {...invalidProps(invalid.has("hourlyCost"))}
            className={`${inputClass} w-36 text-right tabular-nums`}
            value={form.hourlyCost}
            onChange={(e) =>
              onChange((p) => ({ ...p, hourlyCost: e.target.value }))
            }
          />
          <span className="text-sm text-ink-2">円</span>
        </div>
      </label>
    </div>
  );
}

function ReadinessStep({ form, onChange, invalid }: StepProps) {
  return (
    <div className="space-y-6">
      {READINESS_QUESTIONS.map((q) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="font-medium">{q.label}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((option, points) => {
              const checked = form.readiness[q.id] === points;
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                    checked
                      ? "border-accent bg-accent-soft"
                      : "border-line bg-surface"
                  }`}
                >
                  <input
                    type="radio"
                    name={q.id}
                    {...invalidProps(invalid.has(readinessFieldId(q.id)))}
                    className="accent-accent"
                    checked={checked}
                    onChange={() =>
                      onChange((p) => ({
                        ...p,
                        readiness: { ...p.readiness, [q.id]: points },
                      }))
                    }
                  />
                  {option}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
