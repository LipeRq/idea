import { describe, expect, it } from "vitest";
import { TASK_IDS } from "@/lib/diagnosis/master";
import { initialFormState, validateStep, type FormState } from "./form-state";

const filled: FormState = {
  ...initialFormState,
  industry: "製造業",
  employees: "31〜100名",
  taskHours: { ...initialFormState.taskHours, minutes: "100" },
  readiness: { dataLocation: 1, manuals: 1, aiUsage: 1, itStaff: 1, rules: 1, leadership: 1 },
};

describe("validateStep", () => {
  it("正しい入力ならエラーなし", () => {
    for (const step of [0, 1, 2]) expect(validateStep(step, filled)).toBeNull();
  });

  it("エラーには、問題のある入力欄のIDを付ける", () => {
    expect(validateStep(0, { ...filled, industry: "" })).toEqual({
      message: "業種を選んでください",
      fields: ["industry"],
    });
    expect(validateStep(0, { ...filled, employees: "" })?.fields).toEqual(["employees"]);
    expect(validateStep(1, { ...filled, hourlyCost: "999" })?.fields).toEqual(["hourlyCost"]);
  });

  it("範囲外の時間は、その欄だけを示す", () => {
    const form = {
      ...filled,
      taskHours: { ...filled.taskHours, inquiry: "-1", manual: "10001" },
    };
    expect(validateStep(1, form)).toEqual({
      message: "時間は0〜10,000の数字で入力してください",
      fields: ["hours-inquiry", "hours-manual"],
    });
  });

  it("どの業務にも時間がなければ、すべての時間の欄を示す", () => {
    expect(validateStep(1, { ...filled, taskHours: initialFormState.taskHours })?.fields).toEqual(
      TASK_IDS.map((id) => `hours-${id}`),
    );
  });

  it("準備度は未回答の項目だけを示す", () => {
    expect(
      validateStep(2, { ...filled, readiness: { dataLocation: 0, manuals: 3, aiUsage: 2, itStaff: 1 } }),
    ).toEqual({
      message: "すべての項目に回答してください",
      fields: ["readiness-rules", "readiness-leadership"],
    });
  });
});
