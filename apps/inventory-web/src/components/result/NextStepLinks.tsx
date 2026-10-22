import { ExternalLink } from "../ExternalLink";

// 結果画面の下の「次の一歩」。相談ページと AI導入診断への通常のリンク(新しいタブで開く)だけで、通信はしない。
// URL に解析結果・ファイル名を一切付けない。どちらも未設定なら何も出さない。
export function NextStepLinks({ contactUrl, diagnosisUrl }: { contactUrl: string | null; diagnosisUrl: string | null }) {
  if (!contactUrl && !diagnosisUrl) return null;
  const linkClass = "font-semibold text-accent-ink underline underline-offset-2 hover:opacity-80";
  return (
    <section aria-labelledby="next-steps-heading" className="no-print mt-8 rounded-xl border border-line bg-surface p-4 sm:p-6">
      <h2 id="next-steps-heading" className="text-lg font-bold">
        次の一歩
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        リンク先には、この画面の解析結果やファイル名を送りません。相談するときは、必要な内容をご自身でお伝えください。
      </p>
      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {contactUrl && (
          <li>
            <ExternalLink href={contactUrl} className={linkClass}>
              移行や改善を相談する
            </ExternalLink>
            <p className="mt-1 text-sm text-ink-2">マクロ・Access の移行や改修の進め方を、専門家に相談できます。</p>
          </li>
        )}
        {diagnosisUrl && (
          <li>
            <ExternalLink href={diagnosisUrl} className={linkClass}>
              自社のAI活用の余地を無料診断する
            </ExternalLink>
            <p className="mt-1 text-sm text-ink-2">
              業務にかかる時間とIT環境を入力すると、AIで減らせる業務の目安がわかる無料診断です(試算は参考情報です)。
            </p>
          </li>
        )}
      </ul>
    </section>
  );
}
