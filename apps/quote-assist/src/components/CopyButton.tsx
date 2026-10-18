"use client";

import { useState } from "react";

export function CopyButton({ text, label = "コピー" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="no-print rounded-md border border-line-strong px-3 py-1 text-sm hover:bg-surface-2"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      <span aria-live="polite">{copied ? "コピーしました" : label}</span>
    </button>
  );
}
