"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { track } from "@/lib/analytics";
import type { DiagnosisInput } from "@/lib/diagnosis/schema";
import {
  LEAD_LIMITS,
  LeadContactSchema,
  leadFieldErrors,
  type LeadField,
} from "@/lib/lead/schema";
import { hasTopic, toggleTopic } from "@/lib/lead/topics";
import { CONTACT_URL, PRIVACY_POLICY_URL, TERMS_URL } from "@/lib/site";
import { inputClass } from "./DiagnosisForm";
import {
  TURNSTILE_PENDING_MESSAGE,
  TURNSTILE_SITE_KEY,
  TurnstileWidget,
  type TurnstileHandle,
} from "./TurnstileWidget";

type Props = {
  /** 診断に使った入力。結果の要約はサーバーがこれから計算し直して添える */
  input: DiagnosisInput;
  /** 「相談したいテーマ」の候補(結果画面で案内した関連ツール)。選ぶと「相談したい内容」の欄に入る */
  topics?: readonly string[];
  ref?: Ref<LeadFormHandle>;
};

export type LeadFormHandle = {
  /** テーマを選んだ状態にして、「相談したい内容」の欄へ移る(申し込み済みなら完了の表示へ移る) */
  selectTopic(topic: string): void;
};

type Values = {
  companyName: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  consent: boolean;
};

type Errors = Partial<Record<LeadField, string>>;

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "error"; message: string };

const FIELD_ORDER: LeadField[] = ["companyName", "name", "email", "phone", "message", "consent"];

const fieldId = (field: LeadField) => `lead-${field}`;
const errorId = (field: LeadField) => `lead-${field}-error`;

function validate(values: Values): Errors {
  const result = LeadContactSchema.safeParse(values);
  return result.success ? {} : leadFieldErrors(result.error);
}

export function LeadForm({ input, topics = [], ref }: Props) {
  const [values, setValues] = useState<Values>({
    companyName: input.companyName ?? "",
    name: "",
    email: "",
    phone: "",
    message: "",
    consent: false,
  });
  // ハニーポット(人には見えない欄)
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // ボット対策(Turnstile)のトークン。無効なときは使わない
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  // 送信ボタンは完了表示で消えるので、完了の見出しにフォーカスを移す
  useEffect(() => {
    if (status.kind === "done") doneRef.current?.focus();
  }, [status.kind]);

  const focusFirstError = (found: Errors) => {
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) formRef.current?.querySelector<HTMLElement>(`#${fieldId(first)}`)?.focus();
  };

  const update = <K extends keyof Values>(key: K, value: Values[K]) => {
    const next = { ...values, [key]: value };
    setValues(next);
    // 一度エラーになった欄は、入力し直すたびに確かめ直す
    if (errors[key]) setErrors({ ...errors, [key]: validate(next)[key] });
  };

  const setTopic = (topic: string, on: boolean) => update("message", toggleTopic(values.message, topic, on));

  useImperativeHandle(ref, () => ({
    selectTopic(topic) {
      const target = status.kind === "done" ? doneRef.current : messageRef.current;
      if (status.kind !== "done") setTopic(topic, true);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    },
  }));

  const submit = async () => {
    if (status.kind === "submitting") return;
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstError(found);
      return;
    }

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setStatus({ kind: "error", message: TURNSTILE_PENDING_MESSAGE });
      return;
    }

    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(turnstileToken ? { "X-Turnstile-Token": turnstileToken } : {}),
        },
        body: JSON.stringify({ contact: values, website, input }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        setStatus({ kind: "done" });
        track({ name: "lead_submit" });
        return;
      }
      // トークンは1回しか使えないので、送り直せるよう取り直す
      turnstileRef.current?.reset();
      const fieldErrors: Errors = body?.fieldErrors ?? {};
      if (Object.keys(fieldErrors).length > 0) {
        setErrors(fieldErrors);
        setStatus({ kind: "idle" });
        focusFirstError(fieldErrors);
        return;
      }
      setStatus({
        kind: "error",
        message: body?.error ?? "送信に失敗しました。時間をおいてもう一度お試しください。",
      });
    } catch {
      turnstileRef.current?.reset();
      setStatus({ kind: "error", message: "通信エラーが発生しました。もう一度お試しください。" });
    }
  };

  if (status.kind === "done") {
    return (
      <div className="space-y-2">
        <h4 ref={doneRef} tabIndex={-1} className="text-lg font-bold focus:outline-none">
          お申し込みを受け付けました
        </h4>
        <p className="text-ink-2">
          ありがとうございます。内容を確認のうえ、ご入力いただいたメールアドレスあてに担当者からご連絡いたします。
        </p>
      </div>
    );
  }

  const fieldProps = (field: LeadField, hintId?: string) => ({
    id: fieldId(field),
    "aria-invalid": errors[field] ? (true as const) : undefined,
    "aria-describedby":
      [errors[field] ? errorId(field) : null, hintId].filter(Boolean).join(" ") || undefined,
  });

  return (
    <form
      ref={formRef}
      noValidate
      aria-labelledby="lead-heading"
      className="relative space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="space-y-1">
        <h4 id="lead-heading" className="text-lg font-bold">
          無料相談のお申し込み
        </h4>
        <p className="text-sm text-ink-2">
          この診断結果をもとに、優先業務の進め方やツール選定を一緒に具体化します。診断結果の要約(業種、従業員規模、年間削減見込み額、準備度、優先施策の上位3件)もあわせて送信します。
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field field="companyName" label="会社名" required error={errors.companyName}>
          <input
            {...fieldProps("companyName")}
            className={inputClass}
            autoComplete="organization"
            maxLength={LEAD_LIMITS.companyName}
            required
            value={values.companyName}
            onChange={(e) => update("companyName", e.target.value)}
          />
        </Field>
        <Field field="name" label="氏名" required error={errors.name}>
          <input
            {...fieldProps("name")}
            className={inputClass}
            autoComplete="name"
            maxLength={LEAD_LIMITS.name}
            required
            value={values.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </Field>
        <Field field="email" label="メールアドレス" required error={errors.email}>
          <input
            {...fieldProps("email")}
            className={inputClass}
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={LEAD_LIMITS.email}
            required
            value={values.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </Field>
        <Field field="phone" label="電話番号" error={errors.phone}>
          <input
            {...fieldProps("phone")}
            className={inputClass}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={LEAD_LIMITS.phone}
            placeholder="03-1234-5678"
            value={values.phone}
            onChange={(e) => update("phone", e.target.value)}
          />
        </Field>
      </div>

      {topics.length > 0 && (
        <fieldset className="space-y-2" aria-describedby="lead-topics-hint">
          <legend className="font-medium">
            相談したいテーマ
            <RequiredBadge optional />
          </legend>
          <p id="lead-topics-hint" className="text-sm text-muted">
            選ぶと「相談したい内容」の欄に入ります。
          </p>
          {topics.map((topic) => (
            <label key={topic} className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-accent"
                checked={hasTopic(values.message, topic)}
                onChange={(e) => setTopic(topic, e.target.checked)}
              />
              <span>{topic}</span>
            </label>
          ))}
        </fieldset>
      )}

      <Field field="message" label="相談したい内容" required error={errors.message}>
        <textarea
          {...fieldProps("message")}
          ref={messageRef}
          className={`${inputClass} min-h-32`}
          maxLength={LEAD_LIMITS.message}
          required
          placeholder="例:見積書の作成をAIで効率化したい。進め方と費用感を相談したい"
          value={values.message}
          onChange={(e) => update("message", e.target.value)}
        />
      </Field>

      {/* ハニーポット。画面外に置き、読み上げとキーボード操作の対象からも外す */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-0 h-px w-px overflow-hidden">
        <label>
          ウェブサイト(入力しないでください)
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      <div className="space-y-1">
        <label className="flex items-start gap-2">
          <input
            {...fieldProps("consent", "lead-consent-hint")}
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-accent"
            required
            checked={values.consent}
            onChange={(e) => update("consent", e.target.checked)}
          />
          <span>
            {PRIVACY_POLICY_URL ? (
              <a
                href={PRIVACY_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-ink underline"
              >
                個人情報の取り扱い(プライバシーポリシー・別タブで開きます)
              </a>
            ) : (
              "個人情報の取り扱い"
            )}
            に同意する
            <RequiredBadge />
          </span>
        </label>
        <p id="lead-consent-hint" className="pl-6 text-sm text-muted">
          ご入力いただいた情報は、無料相談に関するご連絡のために使用します。
          {TERMS_URL && (
            <>
              お申し込みを含む本サービスのご利用には、
              <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline">
                利用規約(別タブで開きます)
              </a>
              が適用されます。
            </>
          )}
        </p>
        <FieldError field="consent" error={errors.consent} />
      </div>

      <TurnstileWidget action="lead" onTokenChange={setTurnstileToken} ref={turnstileRef} />

      {status.kind === "error" && (
        <p role="alert" className="text-sm font-medium text-critical">
          {status.message}
          {CONTACT_URL && (
            <>
              {" "}
              お急ぎの場合は
              <a href={CONTACT_URL} className="text-accent-ink underline">
                お問い合わせ窓口
              </a>
              をご利用ください。
            </>
          )}
        </p>
      )}

      <button
        type="submit"
        aria-disabled={status.kind === "submitting" || undefined}
        className="rounded-md bg-accent-strong px-6 py-2.5 font-semibold text-white hover:opacity-90 aria-disabled:cursor-wait aria-disabled:opacity-70"
      >
        {status.kind === "submitting" ? "送信しています…" : "無料相談を申し込む"}
      </button>
    </form>
  );
}

function RequiredBadge({ optional = false }: { optional?: boolean }) {
  return (
    <span className="ml-2 rounded border border-line-strong px-1.5 py-px align-middle text-xs font-medium text-ink-2">
      {optional ? "任意" : "必須"}
    </span>
  );
}

function FieldError({ field, error }: { field: LeadField; error?: string }) {
  if (!error) return null;
  return (
    <p id={errorId(field)} className="text-sm font-medium text-critical">
      {error}
    </p>
  );
}

function Field({
  field,
  label,
  required = false,
  error,
  children,
}: {
  field: LeadField;
  label: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={fieldId(field)} className="block font-medium">
        {label}
        <RequiredBadge optional={!required} />
      </label>
      {children}
      <FieldError field={field} error={error} />
    </div>
  );
}
