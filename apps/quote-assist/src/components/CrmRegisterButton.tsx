"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonPrimary } from "./ui";
import { useHydrated } from "./useHydrated";

export function CrmRegisterButton({ inquiryId, label }: { inquiryId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydrated = useHydrated();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={buttonPrimary}
        disabled={busy || !hydrated}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch(`/api/inquiries/${inquiryId}/crm`, { method: "POST" }).catch(() => null);
          setBusy(false);
          if (!res?.ok) {
            setError((await res?.json().catch(() => null))?.error ?? "登録に失敗しました");
            return;
          }
          router.refresh();
        }}
      >
        {busy ? "登録しています…" : `${label}に商談と見積を登録`}
      </button>
      {error && (
        <p role="alert" className="text-sm font-medium text-critical-ink">
          {error}
        </p>
      )}
    </div>
  );
}
