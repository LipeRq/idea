// 「サンプルで試す」の取り込み(サンプル担当が apps/inventory/samples/ に置くものとの契約。docs/design.md §6)。
// manifest.json を検証し、合格したら public/samples/ にファイルをコピーし、画面用に src/generated/samples.json を書く。
// - samples/ や manifest.json が無いときは警告を出して空の一覧にする(「サンプルで試す」を出さない。ビルドは止めない)
// - manifest.json があるのに契約に合わないときはビルドを失敗させる(壊れたサンプルを公開しない)
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { z } from "zod";

export const SUPPORTED_EXTENSIONS = [".xlsm", ".xlsb", ".xls", ".xlsx", ".xlam", ".xltm", ".accdb", ".mdb"];
export const MAX_SAMPLES = 12;
export const MAX_SAMPLE_BYTES = 20 * 1024 * 1024;
// 見どころは画面で箇条書きにする(サンプル担当が文で書いているため、チップではなく1行ずつ表示する)
export const MAX_HIGHLIGHT_CHARS = 120;

const FileName = z
  .string()
  .min(1)
  .max(120)
  .refine((v) => !/[\\/]/.test(v) && !v.includes("..") && !/[\u0000-\u001f\u007f]/.test(v), "ファイル名だけを書いてください(/ \\ .. 制御文字は使えません)")
  .refine((v) => SUPPORTED_EXTENSIONS.includes(extname(v).toLowerCase()), `対応している拡張子(${SUPPORTED_EXTENSIONS.join(" ")})のファイルにしてください`);

export const ManifestSchema = z
  .array(
    z.object({
      file: FileName,
      title: z.string().trim().min(1).max(40),
      description: z.string().trim().min(1).max(200),
      highlights: z.array(z.string().trim().min(1).max(MAX_HIGHLIGHT_CHARS)).max(6).default([]),
    }),
  )
  .max(MAX_SAMPLES)
  .refine((list) => new Set(list.map((s) => s.file)).size === list.length, "file が重複しています");

/** manifest の中身を検証する。問題があれば errors に理由を入れる */
export function validateManifest(json, sourceDir) {
  const parsed = ManifestSchema.safeParse(json);
  if (!parsed.success) {
    return { samples: [], errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(全体)"}: ${i.message}`) };
  }
  const errors = [];
  for (const s of parsed.data) {
    const path = join(sourceDir, s.file);
    if (!existsSync(path) || !statSync(path).isFile()) errors.push(`${s.file}: ファイルがありません`);
    else if (statSync(path).size > MAX_SAMPLE_BYTES) errors.push(`${s.file}: 20MB を超えています`);
    else if (statSync(path).size === 0) errors.push(`${s.file}: 空のファイルです`);
  }
  return { samples: errors.length > 0 ? [] : parsed.data, errors };
}

/** 取り込みを実行する。manifest が無ければ { status: "missing" }、契約違反なら例外 */
export function syncSamples({ sourceDir, publicDir, generatedFile }) {
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(dirname(generatedFile), { recursive: true });
  const manifestPath = join(sourceDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    writeFileSync(generatedFile, "[]\n");
    return { status: "missing", count: 0 };
  }
  let json;
  try {
    json = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    throw new Error(`サンプルの manifest.json を JSON として読めません(${manifestPath}): ${e instanceof Error ? e.message : e}`);
  }
  const { samples, errors } = validateManifest(json, sourceDir);
  if (errors.length > 0) {
    throw new Error(`サンプルの manifest.json が契約(docs/design.md §6)に合いません(${manifestPath}):\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
  mkdirSync(publicDir, { recursive: true });
  for (const s of samples) copyFileSync(join(sourceDir, s.file), join(publicDir, s.file));
  writeFileSync(join(publicDir, "manifest.json"), `${JSON.stringify(samples, null, 2)}\n`);
  writeFileSync(generatedFile, `${JSON.stringify(samples, null, 2)}\n`);
  return { status: "ok", count: samples.length };
}
