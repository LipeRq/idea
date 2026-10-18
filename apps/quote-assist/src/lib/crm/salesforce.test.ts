import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Inquiry } from "../domain/inquiry";
import { DEMO_SCENARIOS } from "../demo/scenarios";
import { approveQuote, registerInquiry, runEstimate } from "../pipeline";
import { loadReferenceData, type ReferenceData } from "../reference/load";
import { DATA_DIR, sampleFile, TEST_TODAY, testDeps } from "../test-helpers";
import { createCrmConnector, salesforceConfigFromEnv, salesforceOptionsFromEnv } from ".";
import { buildSalesforcePayload, type SalesforcePayload } from "./salesforce-payload";
import { createSalesforceRest } from "./salesforce-rest";
import { CrmError } from "./types";

let ref: ReferenceData;
let approved: Inquiry;
let approvedNewCustomer: Inquiry;

async function approvedInquiry(index: number): Promise<Inquiry> {
  const deps = testDeps();
  const s = DEMO_SCENARIOS[index];
  const inquiry = await registerInquiry(deps, {
    email: s.buildEmail(TEST_TODAY),
    files: s.drawings.map((d) => sampleFile(d.fileName)),
  });
  await runEstimate(deps, inquiry.id);
  return approveQuote(deps, inquiry.id);
}

beforeAll(async () => {
  ref = await loadReferenceData(DATA_DIR);
  approved = await approvedInquiry(0);
  approvedNewCustomer = await approvedInquiry(1);
});

const options = { apiVersion: "v62.0", stageName: "Proposal/Price Quote" };
const build = (inquiry: Inquiry) =>
  buildSalesforcePayload({
    inquiry,
    customer: ref.customers.find((c) => c.id === inquiry.extraction.spec.customerId) ?? null,
    company: ref.company,
    rates: ref.rates,
    options,
  });

describe("buildSalesforcePayload", () => {
  it("商談と見積を Composite API(allOrNone)の1リクエストにまとめ、見積は商談を参照する", () => {
    const p = build(approved);
    expect(p.composite.allOrNone).toBe(true);
    expect(p.composite.compositeRequest.map((r) => [r.method, r.url, r.referenceId])).toEqual([
      ["POST", "/services/data/v62.0/sobjects/Opportunity", "opportunity"],
      ["POST", "/services/data/v62.0/sobjects/Quote", "quote"],
    ]);
    expect(p.quote.OpportunityId).toBe("@{opportunity.id}");
  });

  it("金額・期限・取引先・名前は承認した見積から決める", () => {
    const p = build(approved);
    const a = approved.approved!;
    expect(p.opportunity).toMatchObject({
      Name: "ミナモト装置工業 センサブラケット MS-24017 Rev.C ×50",
      StageName: "Proposal/Price Quote",
      Amount: a.total,
      AccountId: "001MK00000000000C01",
      // 承認日 + 見積有効期限30日
      CloseDate: "2026-11-18",
    });
    expect(p.quote).toMatchObject({ Name: a.quoteNumber, ExpirationDate: "2026-11-18" });
    expect(p.quote.Description).toContain(`見積金額(税抜):${a.total.toLocaleString("ja-JP")}円`);
    expect(p.quote.Description).toContain("材料費(SUS304)");
  });

  it("確認事項を商談の説明に入れる", () => {
    const p = build(approved);
    expect(p.opportunity.Description).toContain("顧客への確認事項(2件)");
    expect(p.opportunity.Description).toContain("熱処理は必要でしょうか");
  });

  it("顧客マスタにない(取引先が未対応の)顧客は AccountId を入れない", () => {
    const p = build(approvedNewCustomer);
    expect(p.opportunity).not.toHaveProperty("AccountId");
    expect(String(p.opportunity.Name)).toContain("株式会社こもれび機工");
  });

  it("商談名は120文字まで", () => {
    const long = structuredClone(approved);
    long.extraction.spec.partName = "あ".repeat(200);
    expect(String(build(long).opportunity.Name).length).toBe(120);
  });

  it("承認されていない見積からは作らない", () => {
    expect(() => build({ ...approved, approved: null })).toThrow("承認");
  });
});

describe("環境変数による切り替え", () => {
  const full = { SF_INSTANCE_URL: "https://example.my.salesforce.com", SF_CLIENT_ID: "id", SF_CLIENT_SECRET: "secret" };

  it("3つの環境変数がそろい、https のときだけ本番実装を使う", () => {
    expect(salesforceConfigFromEnv(full)).toEqual({ instanceUrl: full.SF_INSTANCE_URL, clientId: "id", clientSecret: "secret" });
    expect(salesforceConfigFromEnv({ ...full, SF_CLIENT_SECRET: "" })).toBeNull();
    expect(salesforceConfigFromEnv({ ...full, SF_INSTANCE_URL: "http://example.com" })).toBeNull();
    expect(salesforceConfigFromEnv({ ...full, CRM_PROVIDER: "mock" })).toBeNull();
  });

  it("どちらの実装も同じインターフェースで作れる", () => {
    const repo = { list: async () => [], add: async () => {} };
    expect(createCrmConnector(repo, {}).provider).toBe("mock");
    expect(createCrmConnector(repo, full).provider).toBe("salesforce");
  });

  it("API版と商談フェーズは既定値があり、変えられる", () => {
    expect(salesforceOptionsFromEnv({})).toEqual({ apiVersion: "v62.0", stageName: "Proposal/Price Quote" });
    expect(salesforceOptionsFromEnv({ SF_API_VERSION: "v64.0", SF_OPPORTUNITY_STAGE: "見積提示" })).toEqual({
      apiVersion: "v64.0",
      stageName: "見積提示",
    });
    expect(salesforceOptionsFromEnv({ SF_API_VERSION: "../x" }).apiVersion).toBe("v62.0");
  });
});

describe("createSalesforceRest(fetch をモック)", () => {
  const config = { instanceUrl: "https://example.my.salesforce.com/", clientId: "cid", clientSecret: "sec" };
  const payload = (): SalesforcePayload => build(approved);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const ctx = { inquiryId: "x", now: new Date() };

  it("クライアントクレデンシャルでトークンを取り、Composite API に送って id を返す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "tok", instance_url: "https://inst.my.salesforce.com" }))
      .mockResolvedValueOnce(
        json({
          compositeResponse: [
            { referenceId: "opportunity", httpStatusCode: 201, body: { id: "006XX", success: true } },
            { referenceId: "quote", httpStatusCode: 201, body: { id: "0Q0XX", success: true } },
          ],
        }),
      );
    const r = await createSalesforceRest(config, fetchMock).register(payload(), ctx);
    expect(r).toEqual({
      opportunityId: "006XX",
      quoteId: "0Q0XX",
      opportunityUrl: "https://inst.my.salesforce.com/lightning/r/Opportunity/006XX/view",
    });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://example.my.salesforce.com/services/oauth2/token");
    expect(String(tokenInit.body)).toBe("grant_type=client_credentials&client_id=cid&client_secret=sec");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://inst.my.salesforce.com/services/data/v62.0/composite");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual(payload().composite);
  });

  it("一部が失敗したらエラーコードだけを持つ CrmError(項目の値はメッセージに含めない)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "tok" }))
      .mockResolvedValueOnce(
        json({
          compositeResponse: [
            { referenceId: "opportunity", httpStatusCode: 400, body: [{ errorCode: "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST", message: "StageName: 見積" }] },
            { referenceId: "quote", httpStatusCode: 400, body: [{ errorCode: "PROCESSING_HALTED", message: "" }] },
          ],
        }),
      );
    const error = await createSalesforceRest(config, fetchMock).register(payload(), ctx).catch((e) => e);
    expect(error).toBeInstanceOf(CrmError);
    expect(error.codes).toEqual(["INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST", "PROCESSING_HALTED"]);
    expect(error.message).not.toContain("StageName");
  });

  it("認証に失敗したら登録しない", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ error: "invalid_client" }, 400));
    await expect(createSalesforceRest(config, fetchMock).register(payload(), ctx)).rejects.toThrow("認証");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
