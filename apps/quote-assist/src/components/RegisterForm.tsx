"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { todayJst } from "@/lib/dates";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { buttonPrimary, buttonSecondary, inputClass } from "./ui";
import { useHydrated } from "./useHydrated";

const MAX_FILES = 3;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function RegisterForm({ aiMode, operators }: { aiMode: "anthropic" | "demo"; operators: string[] }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [operator, setOperator] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hydrated = useHydrated();

  const addFiles = (list: FileList | File[]) => {
    const incoming = [...list];
    const rejected = incoming.filter((f) => !isPdf(f) || f.size > MAX_FILE_BYTES);
    const accepted = incoming.filter((f) => isPdf(f) && f.size <= MAX_FILE_BYTES);
    const next = [...files, ...accepted].slice(0, MAX_FILES);
    setFiles(next);
    if (rejected.length > 0) setError("PDF(1ファイル10MBまで)だけを追加できます");
    else if (files.length + accepted.length > MAX_FILES) setError("図面は3ファイルまでです");
    else setError(null);
  };

  const loadSample = async (index: number) => {
    const s = DEMO_SCENARIOS[index];
    const email = s.buildEmail(todayJst());
    setFrom(email.from);
    setSubject(email.subject);
    setBody(email.body);
    try {
      const loaded = await Promise.all(
        s.drawings.map(async (d) => {
          const res = await fetch(`/samples/${d.fileName}`);
          return new File([await res.blob()], d.fileName, { type: "application/pdf" });
        }),
      );
      setFiles(loaded);
      setError(null);
    } catch {
      setError("サンプル図面を読み込めませんでした");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0 && body.trim() === "") {
      setError("メール本文を貼り付けるか、図面PDFを追加してください");
      return;
    }
    setSubmitting(true);
    setError(null);
    const form = new FormData();
    form.set("from", from);
    form.set("subject", subject);
    form.set("body", body);
    form.set("operator", operator);
    for (const f of files) form.append("files", f, f.name);
    try {
      const res = await fetch("/api/inquiries", { method: "POST", body: form });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.id) {
        // 画面は遷移後も保持されるので、戻ってきたときのために入力を空に戻す
        setFrom("");
        setSubject("");
        setBody("");
        setFiles([]);
        setSubmitting(false);
        router.push(`/inquiries/${json.id}`);
        return;
      }
      setError(json?.error ?? "登録に失敗しました。時間をおいてもう一度お試しください。");
    } catch {
      setError("通信エラーが発生しました。もう一度お試しください。");
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={submit} className="space-y-6 rounded-xl border border-line bg-surface p-5 sm:p-6" noValidate>
      <div className="space-y-2">
        <p className="text-sm font-semibold">デモ用サンプル</p>
        <div className="flex flex-wrap gap-2">
          {DEMO_SCENARIOS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={buttonSecondary}
              onClick={() => loadSample(i)}
              title={s.description}
              disabled={!hydrated}
            >
              {s.label}を読み込む
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-sm font-medium">差出人のメールアドレス</span>
          <input
            className={inputClass}
            value={from}
            disabled={!hydrated}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="例:buyer@example.co.jp"
          />
        </label>
        <label className="space-y-1">
          <span className="text-sm font-medium">件名</span>
          <input className={inputClass} value={subject} disabled={!hydrated} onChange={(e) => setSubject(e.target.value)} />
        </label>
      </div>

      <label className="block space-y-1 sm:max-w-sm">
        <span className="text-sm font-medium">この見積を作る人(任意)</span>
        <select className={inputClass} value={operator} disabled={!hydrated} onChange={(e) => setOperator(e.target.value)}>
          <option value="">選ばない</option>
          {operators.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <span className="block text-xs text-muted">効果測定の「見積担当者以外が作成した割合」に使います。</span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">メール本文</span>
        <textarea
          className={`${inputClass} min-h-56 font-mono text-sm`}
          value={body}
          disabled={!hydrated}
          onChange={(e) => setBody(e.target.value)}
          placeholder="引き合いメールの本文を貼り付けてください"
        />
      </label>

      <div className="space-y-2">
        <span id="drawings-label" className="text-sm font-medium">
          図面PDF(3ファイル・各10MBまで)
        </span>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={`rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm ${dragging ? "border-accent bg-accent-soft" : "border-line-strong"}`}
        >
          <p className="text-ink-2">ここに図面PDFをドラッグ&ドロップ</p>
          <button
            type="button"
            className={`${buttonSecondary} mt-3`}
            disabled={!hydrated}
            onClick={() => inputRef.current?.click()}
          >
            ファイルを選ぶ
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={!hydrated}
            aria-labelledby="drawings-label"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {files.length > 0 && (
          <ul aria-label="追加した図面" className="space-y-1 text-sm">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2">
                <span className="break-all">
                  {f.name}({Math.ceil(f.size / 1024).toLocaleString("ja-JP")}KB)
                </span>
                <button
                  type="button"
                  className="text-xs text-accent-ink hover:underline"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  aria-label={`${f.name}を外す`}
                >
                  外す
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-critical-ink">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" className={buttonPrimary} disabled={submitting || !hydrated}>
          {submitting ? "読み取り中…" : "登録して読み取る"}
        </button>
        {submitting && (
          <p role="status" className="text-sm text-ink-2">
            {aiMode === "anthropic"
              ? "AIが図面とメールを読み取っています。30秒〜2分ほどかかります。"
              : "デモモードで読み取っています。"}
          </p>
        )}
      </div>
      <p className="text-xs text-muted">
        図面とメールは見積の作成にだけ使います。
        {aiMode === "anthropic"
          ? "読み取りのため Claude API(Anthropic)に送信します(APIで送信したデータは、標準ではモデルの学習に使われません)。"
          : "デモモードでは外部に送信しません。"}
      </p>
    </form>
  );
}
