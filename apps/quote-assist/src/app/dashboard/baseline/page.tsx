import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { BaselineEditor } from "@/components/impact/BaselineEditor";
import { Loading } from "@/components/ui";
import { getDeps } from "@/lib/deps";
import { loadBaseline } from "@/lib/impact/load";

export default function BaselinePage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/dashboard" className="hover:underline">
            効果測定ダッシュボード
          </Link>{" "}
          / ベースライン
        </p>
        <h1 className="text-2xl font-bold">ベースライン(導入前の記録)の入力</h1>
        <p className="max-w-3xl text-ink-2">
          導入前の2〜4週間に、PoC計画書 5章の記録シートへ記入した値を入れます。ここで保存した値が、ダッシュボードの「導入前」になります。導入後の値は、見積アシストの記録から自動で計算するので、入力は要りません。
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Editor />
      </Suspense>
    </div>
  );
}

async function Editor() {
  await connection();
  const deps = getDeps();
  const [{ baseline, source }, ref] = await Promise.all([loadBaseline(deps), deps.reference()]);
  return (
    <BaselineEditor
      origin={source}
      initial={{
        estimators: baseline?.estimators ?? ref.company.quoteStaff,
        note: baseline?.note ?? "",
        rows: baseline?.rows ?? [],
      }}
    />
  );
}
