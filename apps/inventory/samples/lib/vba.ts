import type { TestModule } from "../../test/helpers/ovba";

/**
 * VBA のソースを書くためのタグ。String.raw と同じく \ をそのまま残すので、パス(C:\… や \\server\…)を VBA と同じ表記で書ける。
 * 先頭と末尾の空行だけを取り除く。
 */
export function vba(strings: TemplateStringsArray, ...values: unknown[]): string {
  return String.raw({ raw: strings.raw }, ...values)
    .replace(/^\r?\n/, "")
    .replace(/\r?\n\s*$/, "");
}

/** シート・ブックのドキュメントモジュール(コードが無くても VBE には必ず表示される) */
export function documentModule(name: string, code = ""): TestModule {
  return { name, type: "document", code };
}
