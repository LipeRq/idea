import { connection } from "next/server";
import { salesforceConfigFromEnv } from "@/lib/crm";
import { aiModeFromEnv } from "@/lib/deps";

// 起動時の環境変数で決まる動作モード(ビルド時ではなく、実行時の値を表示する)
export async function ModeBadge() {
  await connection();
  const ai = aiModeFromEnv();
  const crm = salesforceConfigFromEnv() ? "Salesforce" : "Salesforce(モック)";
  return (
    <p className="flex flex-wrap gap-2 text-xs" data-testid="mode">
      <span
        className={`rounded-full border px-2.5 py-1 ${ai === "demo" ? "border-warning text-warning" : "border-line text-ink-2"}`}
      >
        {ai === "demo" ? "デモモード(AI未使用・サンプル図面の固定結果)" : "AI:Claude Opus 5.5"}
      </span>
      <span className="rounded-full border border-line px-2.5 py-1 text-ink-2">連携先:{crm}</span>
    </p>
  );
}
