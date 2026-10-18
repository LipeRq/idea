import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lead, sentBody } from "./fixtures.test-helper";
import { slackText, webhookAdapter, webhookBody, webhookConfigFromEnv } from "./webhook";

const SLACK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webhookConfigFromEnv", () => {
  it("LEAD_WEBHOOK_URL がなければ使わない(null)", () => {
    expect(webhookConfigFromEnv({ NODE_ENV: "test" })).toBeNull();
  });

  it("Slack のURLなら slack 形式、それ以外は json 形式。LEAD_WEBHOOK_FORMAT で変えられる", () => {
    expect(webhookConfigFromEnv({ NODE_ENV: "test", LEAD_WEBHOOK_URL: SLACK_URL })?.format).toBe(
      "slack",
    );
    expect(
      webhookConfigFromEnv({ NODE_ENV: "test", LEAD_WEBHOOK_URL: "https://example.com/hook" })
        ?.format,
    ).toBe("json");
    expect(
      webhookConfigFromEnv({
        NODE_ENV: "test",
        LEAD_WEBHOOK_URL: "https://example.com/hook",
        LEAD_WEBHOOK_FORMAT: "slack",
      })?.format,
    ).toBe("slack");
  });

  it.each([
    [{ LEAD_WEBHOOK_URL: "not a url" }, "URL"],
    [{ LEAD_WEBHOOK_URL: "ftp://example.com" }, "http"],
    [{ LEAD_WEBHOOK_URL: SLACK_URL, LEAD_WEBHOOK_FORMAT: "xml" }, "LEAD_WEBHOOK_FORMAT"],
  ])("設定の誤り %o は例外にする", (env, message) => {
    expect(() => webhookConfigFromEnv({ NODE_ENV: "test", ...env })).toThrow(message);
  });
});

describe("webhookBody", () => {
  it("slack 形式は text に申し込み内容と診断結果の要約を入れる", () => {
    const body = JSON.parse(webhookBody(lead, "slack"));
    expect(Object.keys(body)).toEqual(["text"]);
    expect(body.text).toContain("会社名:テスト工業");
    expect(body.text).toContain("メール:taro@example.co.jp");
    expect(body.text).toContain("見積書の作成を効率化したい");
    expect(body.text).toContain("年間削減見込み額:497万円");
  });

  it("入力に Slack の制御文字(<!channel> など)があっても無効にする", () => {
    const text = slackText({
      ...lead,
      contact: { ...lead.contact, message: "<!channel> 至急 & <https://evil.example|ここ>" },
    });
    expect(text).not.toContain("<!channel>");
    expect(text).toContain("&lt;!channel&gt; 至急 &amp; &lt;https://evil.example|ここ&gt;");
  });

  it("json 形式は項目ごとに分けて送る", () => {
    expect(JSON.parse(webhookBody(lead, "json"))).toEqual({
      type: "lead.created",
      source: "ai-diagnosis",
      submittedAt: "2026-10-18T01:00:00.000Z",
      contact: lead.contact,
      diagnosis: lead.summary,
    });
  });
});

describe("webhookAdapter", () => {
  it("JSONでPOSTし、秘密鍵があれば本文の署名を付ける", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const config = webhookConfigFromEnv({
      NODE_ENV: "test",
      LEAD_WEBHOOK_URL: "https://example.com/hook",
      LEAD_WEBHOOK_SECRET: "s3cret",
    })!;

    await webhookAdapter(config).send(lead);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://example.com/hook");
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    const body = sentBody(fetchMock.mock.calls[0]);
    expect(headers.get("x-lead-signature")).toBe(
      `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`,
    );
  });

  it("秘密鍵がなければ署名を付けない", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
    await webhookAdapter(
      webhookConfigFromEnv({ NODE_ENV: "test", LEAD_WEBHOOK_URL: SLACK_URL })!,
    ).send(lead);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("x-lead-signature")).toBe(false);
  });

  it("HTTPエラーなら例外にする", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    await expect(
      webhookAdapter(webhookConfigFromEnv({ NODE_ENV: "test", LEAD_WEBHOOK_URL: SLACK_URL })!).send(
        lead,
      ),
    ).rejects.toThrow("HTTP 404");
  });
});
