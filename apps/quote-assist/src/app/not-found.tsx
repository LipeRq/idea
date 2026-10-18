import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">ページが見つかりません</h1>
      <p className="text-ink-2">指定された引き合い・過去案件は存在しないか、削除されました。</p>
      <Link href="/" className="text-accent-ink hover:underline">
        見積待ち一覧へ戻る
      </Link>
    </div>
  );
}
