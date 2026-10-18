import type { SalesforcePayload } from "./salesforce-payload";

export type CrmRegistrationResult = {
  opportunityId: string;
  quoteId: string;
  opportunityUrl: string | null;
};

/** CRMとの連携点。MVPはSalesforce(モック/REST)。次段階で kintone などの実装を足す */
export interface CrmConnector {
  readonly provider: "mock" | "salesforce";
  readonly label: string;
  register(payload: SalesforcePayload, ctx: { inquiryId: string; now: Date }): Promise<CrmRegistrationResult>;
}

/** CRM側のエラー。メッセージは画面に出してよい定型文だけにする */
export class CrmError extends Error {
  constructor(
    message: string,
    readonly codes: string[] = [],
  ) {
    super(message);
  }
}
