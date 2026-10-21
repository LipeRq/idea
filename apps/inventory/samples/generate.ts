// デモ用サンプル(架空の中小企業のマクロ付きブック)を生成し、解析して狙いどおりに検出されることを確かめてから、
// 標準の仕様書(AI なし)を samples/output/<名前>.md に、一覧を samples/manifest.json に書き出す。
//
//   cd apps/inventory
//   npx tsx samples/generate.ts          # 生成して書き出す
//   npx tsx samples/generate.ts --check  # 書き出さずに、保存済みのファイルと一致するか・検出結果が狙いどおりかだけを確かめる
//
// 解析と仕様書の作成には、ブラウザ版と同じ入口(src/browser.ts の analyzeBuffer / renderMarkdown)を使う。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeBuffer, renderMarkdown, SEVERITY_LABEL, ENTRY_POINT_KIND_LABEL, DEPENDENCY_KIND_LABEL, type InventoryReport } from "../src/browser";
import { estimateComplexity } from "../src/doc/facts";
import { ruleBasedMigrations } from "../src/doc/migration";
import { maskSecretsInSource } from "../src/secrets";
import { GETSUJI } from "./defs/getsuji";
import { JUCHU } from "./defs/juchu";
import { MITSUMORI } from "./defs/mitsumori";
import { ZAIKO } from "./defs/zaiko";
import type { SampleDefinition } from "./lib/types";
import { buildWorkbook } from "./lib/workbook";

/** manifest.json と画面に並べる順 */
const SAMPLES: SampleDefinition[] = [JUCHU, GETSUJI, ZAIKO, MITSUMORI];

/** 仕様書の「生成日時」。再生成しても同じ内容になるように固定する */
const GENERATED_AT = new Date("2026-10-20T00:00:00Z");

const here = dirname(fileURLToPath(import.meta.url));

interface Built {
  sample: SampleDefinition;
  bytes: Uint8Array;
  report: InventoryReport;
  markdown: string;
}

function build(sample: SampleDefinition): Built {
  const bytes = buildWorkbook(sample.workbook);
  const report = analyzeBuffer(bytes, sample.file, { now: GENERATED_AT });
  const markdown = renderMarkdown(report);
  return { sample, bytes, report, markdown };
}

/** 狙いどおりに検出されたかを確かめ、問題の一覧を返す */
function verify({ sample, report: r, markdown }: Built): string[] {
  const e = sample.expect;
  const problems: string[] = [];
  const ruleIds = new Set(r.findings.map((f) => f.ruleId));
  for (const id of e.findings) if (!ruleIds.has(id)) problems.push(`リスク ${id} が検出されていない`);
  for (const id of e.absentFindings ?? []) if (ruleIds.has(id)) problems.push(`リスク ${id} は検出されない想定`);
  const entryKinds = new Set(r.entryPoints.map((x) => x.kind));
  for (const k of e.entryKinds) if (!entryKinds.has(k)) problems.push(`起動のきっかけ「${ENTRY_POINT_KIND_LABEL[k]}」が無い`);
  const depKinds = new Set(r.dependencies.map((d) => d.kind));
  for (const k of e.dependencyKinds) if (!depKinds.has(k)) problems.push(`外部依存「${DEPENDENCY_KIND_LABEL[k]}」が無い`);
  if (r.warnings.length > 0) problems.push(`解析の警告: ${r.warnings.join(" / ")}`);

  // ダミーのパスワードが JSON にも仕様書にも残っていないこと
  const json = JSON.stringify(r);
  for (const s of e.secrets ?? []) {
    if (json.includes(s)) problems.push(`JSON にパスワード「${s}」が残っている`);
    if (markdown.includes(s)) problems.push(`仕様書にパスワード「${s}」が残っている`);
  }

  // 取り出したソースが元のソース(パスワードを伏せたもの)と一致すること(cp932 で表せない文字を使っていないかの確認も兼ねる)
  for (const m of sample.workbook.vba.modules) {
    const got = r.vba?.modules.find((x) => x.name === m.name);
    if (!got) problems.push(`モジュール ${m.name} が取り出せていない`);
    else if (got.source !== maskSecretsInSource(m.code)) problems.push(`モジュール ${m.name} のソースが元と一致しない(cp932 で表せない文字など)`);
  }

  if (e.complexity) {
    const level = estimateComplexity(r).level;
    if (level !== e.complexity) problems.push(`移行難易度の目安が ${level}(想定は ${e.complexity})`);
  }
  if (e.firstMigration) {
    const first = ruleBasedMigrations(r)[0]?.target ?? "";
    if (!first.startsWith(e.firstMigration)) problems.push(`移行先候補の先頭が「${first}」(想定は「${e.firstMigration}」)`);
  }
  problems.push(...(e.checks?.(r) ?? []));
  return problems;
}

function summary({ sample, report: r }: Built): string {
  const lines = [`■ ${sample.file}(${(r.file.sizeBytes / 1024).toFixed(1)} KB)`];
  lines.push(
    `  規模: シート ${r.stats.sheetCount} / 数式 ${r.stats.formulaCount} / モジュール ${r.stats.moduleCount} / プロシージャ ${r.stats.procedureCount} / コード ${r.stats.codeLineCount} 行 / 移行難易度 ${estimateComplexity(r).level}`,
  );
  lines.push(`  リスク: ${r.findings.map((f) => `[${SEVERITY_LABEL[f.severity]}]${f.ruleId}×${f.count}`).join(" ") || "なし"}`);
  const kinds = new Map<string, number>();
  for (const x of r.entryPoints) kinds.set(ENTRY_POINT_KIND_LABEL[x.kind], (kinds.get(ENTRY_POINT_KIND_LABEL[x.kind]) ?? 0) + 1);
  lines.push(`  起動のきっかけ: ${[...kinds].map(([k, n]) => `${k}×${n}`).join(" ")}`);
  const deps = new Map<string, number>();
  for (const d of r.dependencies) deps.set(d.kind, (deps.get(d.kind) ?? 0) + 1);
  lines.push(`  外部依存: ${[...deps].map(([k, n]) => `${k}×${n}`).join(" ")}`);
  lines.push(`  移行先候補: ${ruleBasedMigrations(r).map((m) => `${m.target}(適合 ${m.fit})`).join(" / ")}`);
  return lines.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const built = SAMPLES.map(build);
  let failed = false;

  for (const b of built) {
    console.log(summary(b));
    const problems = verify(b);
    if (problems.length > 0) {
      failed = true;
      for (const p of problems) console.error(`  × ${p}`);
    } else {
      console.log("  ○ 狙いどおりに検出されました");
    }
  }

  const manifest = SAMPLES.map((s) => ({ file: s.file, title: s.title, description: s.description, highlights: s.highlights }));
  const outputs: [string, Uint8Array | string][] = [
    ...built.flatMap((b): [string, Uint8Array | string][] => [
      [join(here, b.sample.file), b.bytes],
      [join(here, "output", `${basename(b.sample.file).replace(/\.[^.]+$/, "")}.md`), b.markdown],
    ]),
    [join(here, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"],
  ];

  if (check) {
    for (const [path, content] of outputs) {
      const expected = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
      if (!existsSync(path) || !readFileSync(path).equals(expected)) {
        failed = true;
        console.error(`× ${path} が生成結果と一致しません(npx tsx samples/generate.ts で作り直してください)`);
      }
    }
  } else if (!failed) {
    mkdirSync(join(here, "output"), { recursive: true });
    for (const [path, content] of outputs) writeFileSync(path, content);
    console.log(`\n${outputs.length} 個のファイルを書き出しました(${here})`);
  }

  if (failed) {
    console.error(check ? "\n確認に失敗しました" : "\n狙いどおりに検出されないサンプルがあるため、書き出しを中止しました");
    process.exit(1);
  }
  if (check) console.log("\nすべてのサンプルが保存済みのファイルと一致し、狙いどおりに検出されました");
}

main();
