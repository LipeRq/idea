import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { configuredAdapters, deliverLead } from "./deliver";
import { maskContact } from "./dev-log";
import { lead } from "./fixtures.test-helper";

const ORG_ID = "00D5g000004AbCd";
const SLACK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";
// 個人情報。どのログにも出てはいけない
const PERSONAL = [lead.contact.name, lead.contact.email, lead.contact.phone!, lead.contact.message, "テスト工業"];

let info: MockInstance;
let error: MockInstance;

function logged(): string {
  return JSON.stringify([...info.mock.calls, ...error.mock.calls]);
}

beforeEach(() => {
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("configuredAdapters", () => {
  it("設定に応じて送信先を選ぶ。両方あれば両方", () => {
    const names = (env: NodeJS.ProcessEnv) => configuredAdapters(env).adapters.map((a) => a.name);
    expect(names({ NODE_ENV: "development" })).toEqual(["サーバーログ(開発用)"]);
    expect(names({ NODE_ENV: "production" })).toEqual([]);
    expect(names({ NODE_ENV: "production", LEAD_LOG_ONLY: "true" })).toEqual([
      "サーバーログ(開発用)",
    ]);
    expect(names({ NODE_ENV: "production", SALESFORCE_ORG_ID: ORG_ID })).toEqual([
      "Salesforce Web-to-Lead",
    ]);
    expect(
      names({ NODE_ENV: "production", SALESFORCE_ORG_ID: ORG_ID, LEAD_WEBHOOK_URL: SLACK_URL }),
    ).toEqual(["Salesforce Web-to-Lead", "Slack Webhook"]);
  });

  it("設定に誤りがある送信先は除き、開発用ログにも切り替えない", () => {
    const { adapters, configErrors } = configuredAdapters({
      NODE_ENV: "development",
      SALESFORCE_ORG_ID: "bad",
    });
    expect(adapters).toEqual([]);
    expect(configErrors).toHaveLength(1);
  });
});

describe("deliverLead", () => {
  it("開発時は個人情報を伏せてログに出す", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await deliverLead(lead, { NODE_ENV: "development" })).toBe("sent");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    const output = logged();
    for (const value of PERSONAL) expect(output).not.toContain(value);
    // 診断結果の要約は個人情報ではないので出す
    expect(output).toContain("製造業");
  });

  it("本番で送信先がなければ not_configured", async () => {
    expect(await deliverLead(lead, { NODE_ENV: "production" })).toBe("not_configured");
    expect(info).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("SALESFORCE_ORG_ID"));
  });

  it("Salesforce と Webhook の両方に送る", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("ok", { status: 200 }));
    const outcome = await deliverLead(lead, {
      NODE_ENV: "production",
      SALESFORCE_ORG_ID: ORG_ID,
      LEAD_WEBHOOK_URL: SLACK_URL,
    });
    expect(outcome).toBe("sent");
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname).sort()).toEqual([
      "hooks.slack.com",
      "webto.salesforce.com",
    ]);
  });

  it("一方が失敗しても、もう一方に届けば sent。失敗はログに残すが個人情報は出さない", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).includes("slack")
        ? new Response("", { status: 500 })
        : new Response("ok", { status: 200 }),
    );
    const outcome = await deliverLead(lead, {
      NODE_ENV: "production",
      SALESFORCE_ORG_ID: ORG_ID,
      LEAD_WEBHOOK_URL: SLACK_URL,
    });
    expect(outcome).toBe("sent");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Slack Webhook"));
    const output = logged();
    for (const value of [...PERSONAL, SLACK_URL]) expect(output).not.toContain(value);
  });

  it("すべて失敗したら failed", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    expect(
      await deliverLead(lead, { NODE_ENV: "production", LEAD_WEBHOOK_URL: SLACK_URL }),
    ).toBe("failed");
  });

  it("設定に誤りがあれば送らずに failed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(
      await deliverLead(lead, { NODE_ENV: "production", SALESFORCE_FIELD_MAP: "x", SALESFORCE_ORG_ID: ORG_ID }),
    ).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("SALESFORCE_FIELD_MAP"));
  });
});

describe("maskContact", () => {
  it("先頭の1文字と文字数の目安だけを残す", () => {
    expect(maskContact(lead.contact)).toEqual({
      companyName: "テ****",
      name: "山****",
      email: "t***@e****",
      phone: "(記入あり)",
      message: "(13文字)",
    });
  });
});
