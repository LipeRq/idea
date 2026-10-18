import type { MockCrmRepository } from "../storage/types";
import { createMockSalesforce } from "./mock";
import type { SalesforceOptions } from "./salesforce-payload";
import { createSalesforceRest } from "./salesforce-rest";
import type { CrmConnector } from "./types";

type Env = Record<string, string | undefined>;

/** 本番のSalesforceに必要な環境変数がすべてあれば、その設定を返す */
export function salesforceConfigFromEnv(env: Env = process.env) {
  if (env.CRM_PROVIDER === "mock") return null;
  const instanceUrl = env.SF_INSTANCE_URL?.trim();
  const clientId = env.SF_CLIENT_ID?.trim();
  const clientSecret = env.SF_CLIENT_SECRET?.trim();
  if (!instanceUrl || !clientId || !clientSecret) return null;
  if (!/^https:\/\/[^/]+$/.test(instanceUrl.replace(/\/+$/, ""))) return null;
  return { instanceUrl, clientId, clientSecret };
}

export function salesforceOptionsFromEnv(env: Env = process.env): SalesforceOptions {
  return {
    apiVersion: /^v\d+\.\d$/.test(env.SF_API_VERSION ?? "") ? env.SF_API_VERSION! : "v62.0",
    stageName: env.SF_OPPORTUNITY_STAGE?.trim() || "Proposal/Price Quote",
  };
}

export function createCrmConnector(mockRepo: MockCrmRepository, env: Env = process.env): CrmConnector {
  const config = salesforceConfigFromEnv(env);
  return config ? createSalesforceRest(config) : createMockSalesforce(mockRepo);
}
