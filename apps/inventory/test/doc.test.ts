import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { analyzeBuffer, type InventoryReport } from "../src";
import { errorTypeOf } from "../../../packages/shared/src/log";
import {
  AiGenerationError,
  ClaudeSdk,
  createClaudeClient,
  factsText,
  generateAiDocument,
  MODEL,
  parseStructuredOutput,
  type StructuredClient,
  type StructuredRequest,
} from "../src/doc/ai";
import { AiOverallSchema, ModuleSummariesSchema, type AiOverall, type ModuleSummaries } from "../src/doc/aiSchema";
import { batchUnits, buildUnits, estimateTokens } from "../src/doc/chunk";
import { generateDocument } from "../src/doc/document";
import { renderMarkdown } from "../src/doc/markdown";
import { businessFlowDiagram, callFlowDiagram, mermaidLabel } from "../src/doc/mermaid";
import { buildXlsm } from "./helpers/workbooks";
import { SAMPLE_PROJECT } from "./helpers/sampleVba";

const report = analyzeBuffer(buildXlsm(SAMPLE_PROJECT), "売上管理.xlsm", { now: new Date("2026-10-18T00:00:00Z") });

const OVERALL: AiOverall = {
  overview: "売上データを集計してCSVに出力するブックと思われます。",
  businessFlow: {
    summary: "担当者がボタンを押すと集計が走ります。",
    steps: [
      { id: "s1", label: "ボタンを押す", actor: "利用者", next: ["s2"] },
      { id: "s2", label: "DBから売上を取得", actor: "外部システム", next: ["s3", "s9"] },
      { id: "s3", label: "CSVを出力", actor: "マクロ", next: [] },
    ],
  },
  risks: [{ title: "パスワードの直書き", severity: "高", detail: "接続文字列に記載があります。", ruleIds: ["CRED-HARDCODED", "UNKNOWN-RULE"], recommendation: "資格情報を分離します。" }],
  migrations: [{ target: "Python", fit: "高", difficulty: "中", reason: "集計処理が中心のため。", approach: "関数に分けて移植します。", concerns: "実行方法の代替が必要です。" }],
  recommendation: "まずパスとDB接続を整理してから移行します。",
  hearingItems: ["CSVの出力先は今も使っていますか?"],
};

/** 依頼内容を記録し、ユニットに書かれたプロシージャ名をそのまま要約として返すモック */
function mockClient() {
  const calls: StructuredRequest<z.ZodType>[] = [];
  const client: StructuredClient = {
    async generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
      calls.push(req);
      if (req.schema === (ModuleSummariesSchema as z.ZodType)) {
        const modules = [...req.user.matchAll(/<module name="([^"]+)"[^>]*>\n要約するプロシージャ: ([^\n]*)/g)].map((m) => ({
          moduleName: m[1],
          purpose: `${m[1]}の目的`,
          procedures: m[2].startsWith("(なし") ? [] : m[2].split("、").map((name) => ({ name, summary: `${name}の要約` })),
          concerns: m[1] === "売上集計" ? ["パスが固定されている"] : [],
        }));
        return { modules } satisfies ModuleSummaries as z.infer<S>;
      }
      return OVERALL as z.infer<S>;
    },
  };
  return { client, calls };
}

describe("Mermaid", () => {
  it("ラベルの引用符・山括弧をエスケープする", () => {
    expect(mermaidLabel('a "b" <c>\nd')).toBe('"a #quot;b#quot; #lt;c#gt; d"');
  });

  it("業務フロー: 存在しないステップへの矢印は描かない", () => {
    const code = businessFlowDiagram(OVERALL.businessFlow.steps);
    expect(code).toContain('s1(["ボタンを押す"])');
    expect(code).toContain('s2[("DBから売上を取得")]');
    expect(code).toContain("s2 --> s3");
    expect(code).not.toContain("s9");
  });

  it("呼び出し関係図: ノード数の上限を超えたら省いた数を返す", () => {
    const full = callFlowDiagram(report)!;
    expect(full.omitted).toBe(0);
    expect(full.code).toContain('["売上集計.集計実行"]');
    expect(full.code).toContain('[["UserForm1(画面)"]]');
    const small = callFlowDiagram(report, 3)!;
    expect(small.omitted).toBeGreaterThan(0);
  });
});

describe("チャンク分割", () => {
  it("小さいモジュールは1ユニットにまとまる", () => {
    const units = buildUnits(report);
    expect(units.map((u) => [u.name, u.totalParts])).toEqual([
      ["ThisWorkbook", 1],
      ["Sheet1", 1],
      ["売上集計", 1],
      ["CCustomer", 1],
      ["UserForm1", 1],
    ]);
    expect(batchUnits(units)).toHaveLength(1);
  });

  it("上限を超えるモジュールはプロシージャ境界で分け、行を欠かさない", () => {
    const opts = { maxTokens: 200, maxProcedures: 3 };
    const units = buildUnits(report, opts).filter((u) => u.name === "売上集計");
    expect(units.length).toBeGreaterThan(1);
    const source = report.vba!.modules.find((m) => m.name === "売上集計")!.source!;
    expect(units.map((u) => u.text).join("\n")).toBe(source);
    expect([...new Set(units.flatMap((u) => u.procedures))]).toEqual(report.vba!.modules[2].procedures.map((p) => p.name));
    expect(units.every((u) => u.tokens <= 200)).toBe(true);
    for (const b of batchUnits(units, opts)) {
      expect(b.reduce((s, u) => s + u.procedures.length, 0)).toBeLessThanOrEqual(3);
    }
  });

  it("1つのプロシージャが上限を超えるときは行で分け、同じプロシージャを各部分に割り当てる", () => {
    const body = Array.from({ length: 200 }, (_, i) => `    x = x + ${i} ' 加算`).join("\n");
    const big = analyzeBuffer(
      buildXlsm({ modules: [{ name: "巨大", type: "standard", code: `Sub 巨大処理()\n${body}\nEnd Sub` }] }),
      "big.xlsm",
    );
    const units = buildUnits(big, { maxTokens: 500, maxProcedures: 100 });
    expect(units.length).toBeGreaterThan(3);
    expect(units.every((u) => u.procedures[0] === "巨大処理")).toBe(true);
    expect(units.map((u) => u.text).join("\n")).toBe(big.vba!.modules[0].source);
    expect(units.every((u) => u.tokens <= 500)).toBe(true);
  });

  it("日本語は多めに見積もる", () => {
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("売上")).toBe(3);
  });
});

describe("AIへの入力", () => {
  it("作成者名やパスワードを含めない", () => {
    const facts = factsText(report);
    expect(facts).not.toContain("山田太郎");
    expect(facts).not.toContain("佐藤花子");
    expect(facts).not.toContain("secret123");
    expect(facts).toContain("[CRED-HARDCODED]");
    expect(facts).toContain("ThisWorkbook.Workbook_Open → 売上集計.初期化");
  });
});

describe("generateAiDocument(モック)", () => {
  it("モジュール要約 → 全体統合の順に依頼し、結果をまとめる", async () => {
    const { client, calls } = mockClient();
    const progress: string[] = [];
    const doc = await generateAiDocument(report, client, { onProgress: (m) => progress.push(m) });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ effort: "medium", schema: ModuleSummariesSchema });
    expect(calls[0].user).toContain("<source>");
    expect(calls[0].user).toContain("' 売上データを集計してCSVに出力する");
    expect(calls[0].user).not.toContain("P@ssw0rd");
    expect(calls[1]).toMatchObject({ effort: "high", schema: AiOverallSchema });
    expect(calls[1].user).toContain("<facts>");
    expect(calls[1].user).toContain("集計実行: 集計実行の要約");

    expect(doc.modules.get("売上集計")?.purpose).toBe("売上集計の目的");
    expect(doc.modules.get("売上集計")?.procedures.get("明細出力")).toBe("明細出力の要約");
    expect(doc.overall.risks[0].ruleIds).toEqual(["CRED-HARDCODED"]);
    expect(progress).toEqual(["モジュールの要約 1/1", "全体の仕様書を作成中"]);
  });

  it("大きい入力は分割して依頼し、全体統合ではプロシージャ要約を省いたことを注記する", async () => {
    const { client, calls } = mockClient();
    const doc = await generateAiDocument(report, client, { chunk: { maxTokens: 200, maxProcedures: 3 }, reduceMaxTokens: 1_500 });
    expect(calls.length).toBeGreaterThan(3);
    // 分割しても、すべてのプロシージャに要約が付く
    for (const m of report.vba!.modules) {
      for (const p of m.procedures) expect(doc.modules.get(m.name)?.procedures.get(p.name)).toBeTruthy();
    }
    expect(doc.notes.join("\n")).toContain("分割して要約");
    expect(doc.notes.join("\n")).toContain("プロシージャ単位の要約を省き");
    expect(calls[calls.length - 1].user).not.toContain("集計実行: 集計実行の要約");
  });

  it("区分の表記ゆれを正規化する", async () => {
    const loose = {
      ...OVERALL,
      businessFlow: { ...OVERALL.businessFlow, steps: [{ id: "s1", label: "入力", actor: "ユーザー(利用者)", next: [] }] },
      risks: [{ ...OVERALL.risks[0], severity: "重要度は高い" }],
      migrations: [{ ...OVERALL.migrations[0], fit: "やや低", difficulty: "普通" }],
    };
    const client: StructuredClient = {
      async generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
        return (req.schema === (ModuleSummariesSchema as z.ZodType) ? { modules: [] } : loose) as z.infer<S>;
      },
    };
    const doc = await generateAiDocument(report, client);
    expect(doc.overall.businessFlow.steps[0].actor).toBe("利用者");
    expect(doc.overall.risks[0].severity).toBe("高");
    expect(doc.overall.migrations[0]).toMatchObject({ fit: "低", difficulty: "中" });
  });

  it("要約が返らなかったプロシージャは注記する", async () => {
    const client: StructuredClient = {
      async generate<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
        if (req.schema === (ModuleSummariesSchema as z.ZodType)) return { modules: [] } as z.infer<S>;
        return OVERALL as z.infer<S>;
      },
    };
    const doc = await generateAiDocument(report, client);
    expect(doc.notes.some((n) => n.includes("要約が返らなかったプロシージャが 16 件"))).toBe(true);
  });
});

describe("Markdown", () => {
  it("AIなしの標準レポート", () => {
    const md = renderMarkdown(report);
    for (const heading of ["## 1. 概要", "## 2. 処理の流れ", "## 3. シート構成", "## 4. VBAモジュール", "## 5. 外部依存", "## 6. リスク", "## 7. 移行先候補", "## 8. 現場に確認すること", "## 付録"]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("AIを使わず、解析結果だけで作成した標準レポートです。");
    expect(md).toContain("```mermaid\nflowchart LR");
    expect(md).toContain("| 集計実行 | Sub | Public | 7〜19 |");
    expect(md).toContain("ルールで選んだ目安");
    expect(md).not.toContain("P@ssw0rd");
  });

  it("AIの文章を差し込む", async () => {
    const { client } = mockClient();
    const result = await generateDocument(report, client);
    expect(result.aiError).toBeNull();
    const md = result.markdown;
    expect(md).toContain(OVERALL.overview);
    expect(md).toContain("### 業務フロー(AIによる推定)");
    expect(md).toContain("### AIによるリスク評価");
    expect(md).toContain("| Python | 高 | 中 |");
    expect(md).toContain("明細出力の要約");
    expect(md).toContain("### AIへの入力について");
    expect(md).toContain(MODEL);
  });

  it("AIが失敗したら標準レポートにして理由を書く", async () => {
    const client: StructuredClient = { generate: () => Promise.reject(new AiGenerationError("AIが文章の生成を辞退しました")) };
    const result = await generateDocument(report, client);
    expect(result.ai).toBeNull();
    expect(result.aiError).toBe("AIが文章の生成を辞退しました");
    expect(result.markdown).toContain("(AIによる文章生成に失敗したため: AIが文章の生成を辞退しました)");
  });

  it("Access のレポート", () => {
    const access = { ...report, excel: null, vba: null, access: accessInfo() } satisfies InventoryReport;
    const md = renderMarkdown(access);
    expect(md).toContain("## 3. Access");
    expect(md).toContain("### クエリとテーブルの関係図");
    expect(md).toContain("```sql\nSELECT * FROM 顧客;\n```");
  });
});

function accessInfo(): InventoryReport["access"] {
  return {
    engine: "ACE16(Access 2016以降)",
    tables: [{ name: "顧客", rowCount: 10, columns: [{ name: "ID", type: "long", size: 4, nullable: false, autoNumber: true }] }],
    linkedTables: [],
    queries: [
      { name: "顧客一覧", type: "select", hidden: false, sql: "SELECT * FROM 顧客;", tables: ["顧客"], target: null, connect: null },
      { name: "顧客退避", type: "makeTable", hidden: false, sql: "SELECT * INTO 顧客_旧 FROM 顧客;", tables: ["顧客"], target: "顧客_旧", connect: null },
    ],
    relationships: [],
    forms: ["F_顧客"],
    reports: [],
    macros: ["AutoExec"],
    modules: [],
    vbaStatus: "none",
  };
}

describe("ClaudeSdk(ログで例外の種類を照合するために公開する SDK)", () => {
  it("エンジンが使う SDK そのもので、packages/shared の errorTypeOf に渡すと SDK の例外を名前で返す", () => {
    expect(ClaudeSdk).toBe(Anthropic);
    const minified = new ClaudeSdk.RateLimitError(429, undefined, "x", new Headers());
    // 本番ビルドでクラス名が潰れた場合と同じ状態にしても、クラスで照合できる
    Object.defineProperty(minified, "name", { value: "s" });
    expect(errorTypeOf(minified, ClaudeSdk)).toBe("RateLimitError");
    expect(errorTypeOf(minified)).toBe("Error");
  });
});

describe("createClaudeClient", () => {
  function fakeAnthropic(message: Record<string, unknown> | (() => Promise<unknown>)) {
    const stream = vi.fn(() => ({ finalMessage: typeof message === "function" ? message : () => Promise.resolve(message) }));
    return { anthropic: { beta: { messages: { stream } } } as unknown as Anthropic, stream };
  }
  const text = (t: string) => ({ type: "text", text: t });
  const req = { system: "sys", user: "user", schema: z.object({ a: z.string() }), maxTokens: 1000, effort: "medium" as const };

  it("Opus 5.5・フォールバック・effort を指定し、thinking は送らない。形式はスキーマだけを渡す", async () => {
    const { anthropic, stream } = fakeAnthropic({ stop_reason: "end_turn", content: [text('{"a":"ok"}')] });
    await expect(createClaudeClient(anthropic).generate(req)).resolves.toEqual({ a: "ok" });
    const [params, options] = stream.mock.calls[0] as unknown as [Record<string, unknown>, { signal?: AbortSignal }];
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 1000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: "sys",
      messages: [{ role: "user", content: "user" }],
    });
    const outputConfig = params.output_config as { effort: string; format: Record<string, unknown> };
    expect(outputConfig.effort).toBe("medium");
    expect(outputConfig.format.type).toBe("json_schema");
    expect(outputConfig.format.schema).toBeTruthy();
    // parse つきの形式を渡すと、フォールバックを含む応答で SDK が途中までの文を解析して例外になる
    expect(outputConfig.format).not.toHaveProperty("parse");
    expect(params).not.toHaveProperty("thinking");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("生成の途中でフォールバックした応答は、最後の fallback より後の文を使う", async () => {
    const { anthropic } = fakeAnthropic({
      stop_reason: "end_turn",
      content: [text('{"a":"途中'), { type: "fallback", model: "claude-opus-5-5" }, text('{"a":"切り替え後"}')],
    });
    await expect(createClaudeClient(anthropic).generate(req)).resolves.toEqual({ a: "切り替え後" });
  });

  it("切り替え後の文が途中からの続きなら、全体をつなげて解析する", async () => {
    const { anthropic } = fakeAnthropic({
      stop_reason: "end_turn",
      content: [text('{"a":'), { type: "fallback", model: "claude-opus-5-5" }, text('"続き"}')],
    });
    await expect(createClaudeClient(anthropic).generate(req)).resolves.toEqual({ a: "続き" });
  });

  it("parseStructuredOutput はスキーマに合わない出力を null にする", () => {
    expect(parseStructuredOutput([text('{"a":1}')] as never, req.schema)).toBeNull();
    expect(parseStructuredOutput([text("not json")] as never, req.schema)).toBeNull();
  });

  it("refusal / max_tokens / 解析失敗はエラーにする(stop_reason を先に見る)", async () => {
    for (const [message, error] of [
      [{ stop_reason: "refusal", content: [text('{"a":"ok"}')] }, "辞退"],
      [{ stop_reason: "max_tokens", content: [text('{"a":"ok"}')] }, "上限"],
      [{ stop_reason: "end_turn", content: [text('{"a":')] }, "解析できません"],
      [{ stop_reason: "end_turn", content: [] }, "解析できません"],
    ] as const) {
      const { anthropic } = fakeAnthropic(message);
      await expect(createClaudeClient(anthropic).generate(req)).rejects.toThrow(error);
    }
  });

  it("1回の依頼の上限を過ぎたら、分かる理由のエラーにする", async () => {
    const { anthropic, stream } = fakeAnthropic(() => new Promise(() => {}));
    stream.mockImplementation(((_params: unknown, options: { signal: AbortSignal }) => ({
      finalMessage: () =>
        new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()))),
    })) as never);
    await expect(createClaudeClient(anthropic, { requestTimeoutMs: 20 }).generate(req)).rejects.toThrow(AiGenerationError);
  });

  it("外側の signal で中止されたときは、その例外をそのまま返す", async () => {
    const { anthropic, stream } = fakeAnthropic(() => new Promise(() => {}));
    stream.mockImplementation(((_params: unknown, options: { signal: AbortSignal }) => ({
      finalMessage: () =>
        new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()))),
    })) as never);
    const outer = new AbortController();
    const pending = createClaudeClient(anthropic, { signal: outer.signal }).generate(req);
    outer.abort();
    await expect(pending).rejects.toBeInstanceOf(Anthropic.APIUserAbortError);
  });
});
