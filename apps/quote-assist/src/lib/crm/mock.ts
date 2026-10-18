import type { MockCrmRepository } from "../storage/types";
import type { CrmConnector } from "./types";

// デモ用のSalesforce。リクエストの内容をそのまま保存し、Salesforce風のidを返す。
// 登録内容は /crm-mock の画面で確認できる。
export function createMockSalesforce(repo: MockCrmRepository): CrmConnector {
  return {
    provider: "mock",
    label: "Salesforce(モック)",
    async register(payload, { inquiryId, now }) {
      const n = (await repo.list()).length + 1;
      const suffix = String(n).padStart(10, "0");
      const opportunityId = `006MK${suffix}AAA`;
      const quoteId = `0Q0MK${suffix}AAA`;
      await repo.add({
        inquiryId,
        registeredAt: now.toISOString(),
        opportunity: { ...payload.opportunity, Id: opportunityId },
        quote: { ...payload.quote, OpportunityId: opportunityId, Id: quoteId },
      });
      return { opportunityId, quoteId, opportunityUrl: `/crm-mock#${opportunityId}` };
    },
  };
}
