import { afterEach, describe, expect, it, vi } from "vitest";
import { lead, sentBody } from "./fixtures.test-helper";
import {
  salesforceAdapter,
  salesforceConfigFromEnv,
  webToLeadFields,
  type SalesforceConfig,
} from "./salesforce";

const ORG_ID = "00D5g000004AbCdEAA";

function config(env: Record<string, string> = {}): SalesforceConfig {
  return salesforceConfigFromEnv({ NODE_ENV: "test", SALESFORCE_ORG_ID: ORG_ID, ...env })!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("salesforceConfigFromEnv", () => {
  it("SALESFORCE_ORG_ID がなければ使わない(null)", () => {
    expect(salesforceConfigFromEnv({ NODE_ENV: "test" })).toBeNull();
    expect(salesforceConfigFromEnv({ NODE_ENV: "test", SALESFORCE_ORG_ID: " " })).toBeNull();
  });

  it("既定の送信先は Web-to-Lead で、文字コード UTF-8 を指定する", () => {
    expect(config().endpoint.toString()).toBe(
      "https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8",
    );
    expect(config({ SALESFORCE_ORG_ID: "00D5g000004AbCd" }).orgId).toBe("00D5g000004AbCd");
  });

  it("送信先を変えられる(My Domain など)。encoding がなければ付ける", () => {
    const url = "https://example.my.salesforce.com/servlet/servlet.WebToLead?orgId=x";
    expect(config({ SALESFORCE_WEB_TO_LEAD_URL: url }).endpoint.toString()).toBe(
      `${url}&encoding=UTF-8`,
    );
  });

  it.each([
    [{ SALESFORCE_ORG_ID: "12345" }, "SALESFORCE_ORG_ID"],
    [{ SALESFORCE_WEB_TO_LEAD_URL: "http://webto.salesforce.com/x" }, "https"],
    [{ SALESFORCE_WEB_TO_LEAD_URL: "not a url" }, "URL"],
    [{ SALESFORCE_FIELD_MAP: "{oops" }, "JSON"],
    [{ SALESFORCE_FIELD_MAP: "[]" }, "形"],
    [{ SALESFORCE_FIELD_MAP: '{"unknown":"00N000000000001"}' }, "unknown"],
    [{ SALESFORCE_FIELD_MAP: '{"industry":"bad name!"}' }, "industry"],
  ])("設定の誤り %o は例外にする", (env, message) => {
    expect(() =>
      salesforceConfigFromEnv({ NODE_ENV: "test", SALESFORCE_ORG_ID: ORG_ID, ...env }),
    ).toThrow(message);
  });
});

describe("webToLeadFields", () => {
  it("標準項目に氏名・会社名・メール・電話・説明(相談内容と診断結果の要約)を入れる", () => {
    const fields = webToLeadFields(lead, config());
    expect(fields.get("oid")).toBe(ORG_ID);
    expect(fields.get("last_name")).toBe("山田 太郎");
    expect(fields.get("company")).toBe("テスト工業");
    expect(fields.get("email")).toBe("taro@example.co.jp");
    expect(fields.get("phone")).toBe("03-1234-5678");
    const description = fields.get("description")!;
    expect(description).toContain("見積書の作成を効率化したい");
    expect(description).toContain("業種:製造業");
    expect(description).toContain("年間削減見込み額:497万円");
    expect(description).toContain("AI導入の準備度:100点(推進段階)");
    expect(description).toContain("1. 議事録・報告書の作成");
    // 設定していない項目は送らない
    expect(fields.has("lead_source")).toBe(false);
    expect(fields.has("debug")).toBe(false);
  });

  it("電話番号がなければ送らない", () => {
    const fields = webToLeadFields(
      { ...lead, contact: { ...lead.contact, phone: undefined } },
      config(),
    );
    expect(fields.has("phone")).toBe(false);
  });

  it("リードソース、カスタム項目への対応付け、デバッグを設定できる", () => {
    const fields = webToLeadFields(
      lead,
      config({
        SALESFORCE_LEAD_SOURCE: "AI導入診断",
        SALESFORCE_FIELD_MAP: JSON.stringify({
          industry: "00N5g00000AAAAA",
          employees: "00N5g00000BBBBB",
          annualSavedAmount: "00N5g00000CCCCC",
          readinessScore: "00N5g00000DDDDD",
          topTasks: "00N5g00000EEEEE",
        }),
        SALESFORCE_DEBUG_EMAIL: "admin@example.com",
      }),
    );
    expect(fields.get("lead_source")).toBe("AI導入診断");
    expect(fields.get("00N5g00000AAAAA")).toBe("製造業");
    expect(fields.get("00N5g00000BBBBB")).toBe("31〜100名");
    expect(fields.get("00N5g00000CCCCC")).toBe(String(lead.summary.annualSavedAmount));
    expect(fields.get("00N5g00000DDDDD")).toBe("100");
    expect(fields.get("00N5g00000EEEEE")).toMatch(/^1\. 議事録・報告書の作成/);
    expect(fields.get("debug")).toBe("1");
    expect(fields.get("debugEmail")).toBe("admin@example.com");
  });
});

describe("salesforceAdapter", () => {
  it("Web-to-Lead にフォーム形式(UTF-8)でPOSTする", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html></html>", { status: 200 }));

    await salesforceAdapter(config()).send(lead);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded;charset=UTF-8",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = new URLSearchParams(sentBody(fetchMock.mock.calls[0]));
    expect(body.get("company")).toBe("テスト工業");
    // 日本語は UTF-8 のパーセント符号化で送る
    expect(sentBody(fetchMock.mock.calls[0])).toContain(
      `company=${encodeURIComponent("テスト工業")}`,
    );
  });

  it("HTTPエラーなら例外にする(エラーには個人情報を含めない)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    const sending = salesforceAdapter(config()).send(lead);
    await expect(sending).rejects.toThrow("HTTP 503");
    await expect(sending).rejects.not.toThrow(/taro|山田|テスト工業/);
  });
});
