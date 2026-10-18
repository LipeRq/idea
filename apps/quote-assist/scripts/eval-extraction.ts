// 抽出精度・処理時間・API費用の評価:npm run eval
// デモ用の引き合い(src/lib/demo/scenarios.ts)を、設定中の方式(APIキーがあれば Claude、なければデモの固定結果)で
// 読み取り、正解ラベルと項目ごとに照合する。保存はメモリだけで行い、ファイルには残さない。

import fs from "node:fs";
import path from "node:path";
import { createMockSalesforce } from "../src/lib/crm/mock";
import { todayJst } from "../src/lib/dates";
import { DEMO_SCENARIOS } from "../src/lib/demo/scenarios";
import { aiModeFromEnv } from "../src/lib/deps";
import { evaluateExtraction } from "../src/lib/evaluate";
import { registerInquiry } from "../src/lib/pipeline";
import { loadReferenceData } from "../src/lib/reference/load";
import { createMemoryStorage } from "../src/lib/storage/memory-store";
import { summarizeMetrics } from "../src/lib/views";

async function main() {
  const storage = createMemoryStorage();
  const aiMode = aiModeFromEnv();
  const deps = {
    storage,
    reference: () => loadReferenceData(),
    aiMode,
    crm: createMockSalesforce(storage.mockCrm),
    now: () => new Date(),
  };
  console.log(`方式:${aiMode === "anthropic" ? "Claude API" : "デモモード(固定結果。精度は100%になる)"}\n`);
  const today = todayJst();
  let correct = 0;
  let total = 0;
  for (const s of DEMO_SCENARIOS) {
    const files = s.drawings.map((d) => ({
      name: d.fileName,
      data: new Uint8Array(fs.readFileSync(path.join("public", "samples", d.fileName))),
    }));
    const inquiry = await registerInquiry(deps, { email: s.buildEmail(today), files });
    const r = evaluateExtraction(inquiry.extraction.spec, inquiry.extraction.questions, s.truth);
    const m = summarizeMetrics(inquiry);
    correct += r.fields.filter((f) => f.correct).length;
    total += r.fields.length;
    console.log(`■ ${s.label}`);
    console.log(
      `  項目の正解率 ${(r.accuracy * 100).toFixed(0)}% / 確認事項の再現率 ${(r.questionRecall * 100).toFixed(0)}%` +
        ` / 処理時間 ${(m.totalMs / 1000).toFixed(1)}秒 / トークン 入力${m.inputTokens}・出力${m.outputTokens} / 概算 ${m.costJpy.toFixed(1)}円`,
    );
    for (const f of r.fields.filter((x) => !x.correct)) console.log(`  × ${f.key}: 正解 ${f.expected} / 抽出 ${f.actual}`);
    if (r.missedQuestions.length > 0) console.log(`  確認事項の漏れ: ${r.missedQuestions.join(", ")}`);
  }
  console.log(`\n全体の項目正解率 ${((correct / total) * 100).toFixed(0)}%(${correct}/${total})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
