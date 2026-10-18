import { DiagnosisApp } from "@/components/DiagnosisApp";

const POINTS = [
  {
    title: "根拠のある数字",
    body: "業務ごとの工数と一般的な削減率から、削減時間・削減額・投資回収の目安を計算します。",
  },
  {
    title: "御社に合わせた施策",
    body: "業種・規模・IT環境をふまえて、AIが優先施策と進め方を具体的に提案します。",
  },
  {
    title: "3ヶ月のロードマップ",
    body: "最初の一歩から全社展開まで、明日から動ける計画にまとめます。",
  },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-10 px-4 py-10 sm:py-16">
      <section className="space-y-4">
        <p className="text-sm font-semibold text-accent-ink">無料・約3分</p>
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
          御社の業務、AIでどれだけ減らせるか。
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-ink-2">
          業務にかかっている時間とIT環境を入力するだけで、AIで削減できる業務と削減額、取り組む順番がわかります。
        </p>
        <ul className="grid gap-4 pt-2 sm:grid-cols-3">
          {POINTS.map((p) => (
            <li key={p.title} className="rounded-lg border border-line bg-surface p-4">
              <p className="font-semibold">{p.title}</p>
              <p className="mt-1 text-sm text-ink-2">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <DiagnosisApp />

      <footer className="no-print border-t border-line pt-6 text-xs text-muted">
        入力内容は診断レポートの作成にのみ使用します。会社名や課題の記入は任意です。
      </footer>
    </main>
  );
}
