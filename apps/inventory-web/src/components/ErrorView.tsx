"use client";

import { useEffect, useRef } from "react";
import { describeFailure, type Failure } from "@/lib/errors";
import { buttonPrimary } from "./ui";

export function ErrorView({ fileName, failure, onBack }: { fileName: string; failure: Failure; onBack: () => void }) {
  const text = describeFailure(failure);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  return (
    <section aria-labelledby="error-heading" className="mt-2 rounded-xl border border-critical bg-critical-soft p-4 text-critical-ink sm:p-6">
      <div role="alert">
        <h2 id="error-heading" className="text-lg font-bold">
          {text.title}
        </h2>
        <p className="mt-2">{text.hint}</p>
        <p className="mt-2 text-sm">
          ファイル: <span className="break-all">{fileName}</span>
        </p>
      </div>
      <button ref={back} type="button" className={`${buttonPrimary} mt-4`} onClick={onBack}>
        別のファイルを選ぶ
      </button>
    </section>
  );
}
