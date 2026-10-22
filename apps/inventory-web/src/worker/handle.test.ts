import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CorruptFileError, InventoryReportSchema, LimitExceededError, PasswordError, UnsupportedFileError } from "@engine/browser";
import { CONSENT_VERSION } from "@/lib/ai-consent";
import { accessFixture, fakeFile, MARKER, plainWorkbook, secretWorkbook } from "@/test/fixtures";
import { analyzeFile, buildAiPayload, ENCRYPTED_ACCESS_PREFIX, handleRequest, toWorkerError } from "./handle";
import type { WorkerResponse } from "./protocol";

const now = new Date("2026-10-20T00:00:00Z");

describe("analyzeFile", () => {
  it("ブックを解析して、抽出結果・画面用の値・仕様書(HTML と図のコード)を返す", async () => {
    const phases: string[] = [];
    const { report, derived, document } = await analyzeFile(fakeFile(plainWorkbook(), "売上管理.xlsm"), {}, (p) => phases.push(p), now);
    expect(phases).toEqual(["reading", "analyzing", "rendering"]);
    expect(report.file.name).toBe("売上管理.xlsm");
    expect(report.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(derived.formatLabel).toContain("Excel");
    expect(derived.findings.length).toBe(report.findings.length);
    expect(derived.diagrams.callFlow?.code).toMatch(/^flowchart/);
    expect(document.markdown).toContain("# ");
    expect(document.diagrams.length).toBeGreaterThan(0);
    expect(document.html).toContain('class="mermaid-src" data-mermaid-index="0"');
    expect(document.previewable).toBe(true);
  });

  it("詳細タブと一覧に使う値(依存関係のまとめ・ラベル・外部への参照)を返す", async () => {
    const { derived, report } = await analyzeFile(fakeFile(plainWorkbook(), "売上管理.xlsm"), {}, () => undefined, now);
    expect(derived.labels.moduleType.standard).toBe("標準モジュール");
    expect(derived.labels.procedureKind.sub).toBe("Sub");
    expect(derived.labels.queryType.select).toBe("選択");
    expect(derived.dependencyGroups.reduce((sum, g) => sum + g.items.reduce((s, i) => s + i.count, 0), 0)).toBe(report.dependencies.length);
    expect(Array.isArray(derived.externalRefs)).toBe(true);
    const access = await analyzeFile(fakeFile(accessFixture("queryTestV2010.accdb"), "a.accdb"), {}, () => undefined, now);
    expect(access.derived.labels.queryType.update).toBe("更新");
  });

  it("ダミーのパスワードは解析の段階で伏せ字になる", async () => {
    const { report, document } = await analyzeFile(fakeFile(secretWorkbook(), "顧客台帳.xlsm"), {}, () => undefined, now);
    expect(JSON.stringify(report)).not.toContain(MARKER.password);
    expect(document.markdown).not.toContain(MARKER.password);
    expect(report.findings.some((f) => f.ruleId === "CRED-HARDCODED")).toBe(true);
  });
});

describe("toWorkerError(クラス名ではなく instanceof で判定し、固定のコードにする)", () => {
  it("エンジンのエラーの種類ごとのコード", () => {
    expect(toWorkerError(new CorruptFileError("壊れています"))).toEqual({ code: "corrupt", message: "壊れています" });
    expect(toWorkerError(new PasswordError("パスワードが違います")).code).toBe("password");
    expect(toWorkerError(new UnsupportedFileError("暗号化されたブックです")).code).toBe("unsupported");
    expect(toWorkerError(new UnsupportedFileError(`${ENCRYPTED_ACCESS_PREFIX}データベースは…`)).code).toBe("encryptedAccess");
    const limit = toWorkerError(new LimitExceededError("time", "時間切れ"));
    expect(limit).toMatchObject({ code: "limit", kind: "time" });
  });

  it("想定外の例外はメッセージを返さない(入力の一部やスタックを画面に出さない)", () => {
    expect(toWorkerError(new TypeError("secret input 1234"))).toEqual({ code: "internal", message: "" });
  });

  it("暗号化 Access の判定に使う文言は、エンジンのブラウザ用モジュールの文言と一致している", () => {
    const source = readFileSync(join(__dirname, "../../../inventory/src/browser/mdbEnvironment.ts"), "utf8");
    expect(source).toContain(`"${ENCRYPTED_ACCESS_PREFIX}`);
  });
});

describe("handleRequest", () => {
  const run = async (file: File, limits = {}) => {
    const out: WorkerResponse[] = [];
    await handleRequest({ type: "analyze", id: 7, file, limits }, (r) => out.push(r));
    return out;
  };

  it("途中で切れたブックは corrupt を返す", async () => {
    const bytes = plainWorkbook();
    const out = await run(fakeFile(bytes.slice(0, bytes.length >> 1), "壊れた.xlsm"));
    expect(out.at(-1)).toMatchObject({ type: "error", id: 7, error: { code: "corrupt" } });
  });

  it("上限を渡すと効く(制限時間 0 で kind=time)", async () => {
    const out = await run(fakeFile(plainWorkbook(), "a.xlsm"), { timeLimitMs: 0 });
    expect(out.at(-1)).toMatchObject({ type: "error", error: { code: "limit", kind: "time" } });
  });

  it("ファイルを読めないときは readFailed", async () => {
    const file = { name: "a.xlsm", size: 1, arrayBuffer: () => Promise.reject(new DOMException("x", "NotReadableError")) } as unknown as File;
    const out = await run(file);
    expect(out.at(-1)).toMatchObject({ type: "error", error: { code: "readFailed", message: "" } });
  });

  it("Access ファイル(クエリとテーブル)を解析できる", async () => {
    const out = await run(fakeFile(accessFixture("queryTestV2010.accdb"), "q.accdb"));
    const last = out.at(-1);
    expect(last?.type).toBe("analyzed");
    if (last?.type === "analyzed") {
      expect(last.result.report.access?.queries.length).toBeGreaterThan(0);
      expect(last.result.derived.diagrams.queries).not.toBeNull();
    }
  });
});

describe("buildAiPayload(AI 版の送信内容)", () => {
  it("作成者・会社名・タイトル・ファイル名・指紋・警告を外し、ソースとAPIキーは残す(同意画面で示す)", async () => {
    const { report } = await analyzeFile(fakeFile(secretWorkbook(), "顧客台帳.xlsm"), {}, () => undefined, now);
    expect(report.properties.creator).toBeTruthy();
    const payload = buildAiPayload(report, true, CONSENT_VERSION);
    const body = JSON.parse(payload.body);
    expect(body.consentVersion).toBe(CONSENT_VERSION);
    expect(body.report.file).toMatchObject({ name: "対象ファイル.xlsm", sha256: "" });
    expect(body.report.properties).toMatchObject({ creator: null, lastModifiedBy: null, company: null, title: null });
    expect(body.report.warnings).toEqual([]);
    for (const word of [report.properties.creator!, report.properties.company ?? "株式会社サンプル商事", "顧客台帳", report.file.sha256, MARKER.password]) {
      expect(payload.body).not.toContain(word);
    }
    expect(payload.body).toContain(MARKER.source);
    expect(payload.body).toContain(MARKER.apiKey);
    expect(InventoryReportSchema.safeParse(body.report).success).toBe(true);
    expect(payload.bodyBytes).toBe(new TextEncoder().encode(payload.body).length);
    expect(payload.summary.maskedCredentials).toBeGreaterThan(0);
    expect(payload.summary.modulesWithSource).toBe(payload.summary.modules);
    expect(payload.estimate.batches).toBeGreaterThan(0);
    // 伏せ字にならない秘密は、場所付きで示す
    const kinds = new Set(payload.sensitive.hits.map((h) => h.kind));
    expect(kinds).toContain("email");
    expect(kinds).toContain("webhook");
    expect(kinds).toContain("secretKeyword");
    expect(payload.sensitive.hits.find((h) => h.kind === "email")?.location).toMatch(/^通知連携 \d+行目$/);
  });

  it("「ソースコード本文と SQL を送らない」では source / sql が null になる", async () => {
    const { report } = await analyzeFile(fakeFile(secretWorkbook(), "顧客台帳.xlsm"), {}, () => undefined, now);
    const payload = buildAiPayload(report, false, CONSENT_VERSION);
    expect(payload.body).not.toContain(MARKER.source);
    expect(JSON.parse(payload.body).report.vba.modules.every((m: { source: unknown }) => m.source === null)).toBe(true);
    expect(payload.summary.modulesWithSource).toBe(0);
    expect(payload.summary.codeLines).toBe(0);
  });
});
