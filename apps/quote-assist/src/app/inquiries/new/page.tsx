import { connection } from "next/server";
import { Suspense } from "react";
import { RegisterForm } from "@/components/RegisterForm";
import { Loading } from "@/components/ui";
import { aiModeFromEnv } from "@/lib/deps";

export default function NewInquiryPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">引き合い登録</h1>
        <p className="max-w-3xl text-ink-2">
          引き合いメールの本文を貼り付け、2D図面のPDFを追加してください。品名・材質・数量・寸法・公差・表面処理・納期などを読み取り、根拠と確からしさを表示します。
        </p>
      </div>
      <Suspense fallback={<Loading />}>
        <Form />
      </Suspense>
    </div>
  );
}

async function Form() {
  await connection();
  return <RegisterForm aiMode={aiModeFromEnv()} />;
}
