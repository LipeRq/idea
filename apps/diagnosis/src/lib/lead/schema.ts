import { z } from "zod";
import { DiagnosisInputSchema } from "../diagnosis/schema";

// 無料相談の申し込みフォーム。画面(送信前の確認)とサーバー(受け付け時の検証)で同じスキーマを使う。

// Salesforce のリードの項目の長さ(姓80・会社名255・メール80・電話40)に収まるようにする。
// (超えると Web-to-Lead でリードが作られないことがある)
export const LEAD_LIMITS = {
  companyName: 100,
  name: 50,
  email: 80,
  phone: 30,
  message: 2_000,
} as const;

function isPhoneNumber(value: string): boolean {
  const digits = value.replace(/\D/g, "").length;
  return /^\+?[0-9][0-9\- ()]*[0-9]$/.test(value) && digits >= 10 && digits <= 15;
}

export const LeadContactSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "会社名を入力してください")
    .max(LEAD_LIMITS.companyName, `会社名は${LEAD_LIMITS.companyName}文字以内で入力してください`),
  name: z
    .string()
    .trim()
    .min(1, "氏名を入力してください")
    .max(LEAD_LIMITS.name, `氏名は${LEAD_LIMITS.name}文字以内で入力してください`),
  email: z
    .string()
    .trim()
    .min(1, "メールアドレスを入力してください")
    .max(LEAD_LIMITS.email, "メールアドレスが長すぎます")
    .pipe(z.email("メールアドレスの形式が正しくありません(例:taro@example.co.jp)")),
  // 全角の数字やハイフンも受け付ける(NFKCで半角にそろえる)
  phone: z
    .string()
    .trim()
    .max(LEAD_LIMITS.phone, "電話番号が長すぎます")
    .transform((v) => v.normalize("NFKC"))
    .refine(
      (v) => v === "" || isPhoneNumber(v),
      "電話番号は数字とハイフンで入力してください(例:03-1234-5678)",
    )
    .optional(),
  message: z
    .string()
    .trim()
    .min(1, "相談したい内容を入力してください")
    .max(LEAD_LIMITS.message, `相談したい内容は${LEAD_LIMITS.message}文字以内で入力してください`),
  consent: z.literal(true, "個人情報の取り扱いへの同意が必要です"),
});

export type LeadContactInput = z.input<typeof LeadContactSchema>;
export type LeadContact = z.output<typeof LeadContactSchema>;
export type LeadField = keyof LeadContactInput;

export const LeadRequestSchema = z.object({
  contact: LeadContactSchema,
  // 人には見えない欄(ハニーポット)。入力があればボットとみなす
  website: z.string().max(200).optional(),
  // 診断の入力。結果の要約はサーバーで計算し直して添える
  input: DiagnosisInputSchema,
});

/** 検証エラーを欄ごとの最初のメッセージにまとめる */
export function leadFieldErrors(
  error: z.ZodError,
  prefix: readonly PropertyKey[] = [],
): Partial<Record<LeadField, string>> {
  const errors: Partial<Record<LeadField, string>> = {};
  for (const issue of error.issues) {
    if (!prefix.every((key, i) => issue.path[i] === key)) continue;
    const field = issue.path[prefix.length];
    if (typeof field === "string" && field in LeadContactSchema.shape) {
      errors[field as LeadField] ??= issue.message;
    }
  }
  return errors;
}
