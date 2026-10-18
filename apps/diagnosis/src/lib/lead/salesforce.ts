import { formatTopTasks, leadDescription } from "./summary";
import type { Lead, LeadAdapter } from "./types";

// Salesforce の Web-to-Lead へ、フォームと同じ形式(application/x-www-form-urlencoded)で送る。
// Web-to-Lead は失敗しても HTTP 200 を返すことがあるため、取り込みの確認は Salesforce 側で行う
// (SALESFORCE_DEBUG_EMAIL を設定すると、Salesforce から受信内容のメールが届く)。

const DEFAULT_ENDPOINT = "https://webto.salesforce.com/servlet/servlet.WebToLead";
const ORG_ID = /^00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
// カスタム項目のID(00N で始まる)や項目名(first_name など)
const FIELD_NAME = /^[A-Za-z0-9_]{1,80}$/;
const SEND_TIMEOUT_MS = 10_000;

/** 標準項目以外に送れる値。SALESFORCE_FIELD_MAP で Salesforce の項目(カスタム項目のIDなど)に対応付ける */
export const SALESFORCE_MAPPABLE_KEYS = [
  "industry",
  "employees",
  "annualSavedAmount",
  "annualSavedHours",
  "readinessScore",
  "readinessLevel",
  "topTasks",
  "message",
] as const;
export type SalesforceMappableKey = (typeof SALESFORCE_MAPPABLE_KEYS)[number];

export type SalesforceConfig = {
  orgId: string;
  endpoint: URL;
  leadSource?: string;
  fieldMap: Partial<Record<SalesforceMappableKey, string>>;
  debugEmail?: string;
};

/** SALESFORCE_ORG_ID がなければ null(このアダプターを使わない)。設定に誤りがあれば例外 */
export function salesforceConfigFromEnv(env: NodeJS.ProcessEnv): SalesforceConfig | null {
  const orgId = env.SALESFORCE_ORG_ID?.trim();
  if (!orgId) return null;
  if (!ORG_ID.test(orgId)) {
    throw new Error("SALESFORCE_ORG_ID の形式が正しくありません(00Dで始まる15桁または18桁)");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(env.SALESFORCE_WEB_TO_LEAD_URL?.trim() || DEFAULT_ENDPOINT);
  } catch {
    throw new Error("SALESFORCE_WEB_TO_LEAD_URL がURLとして読めません");
  }
  if (endpoint.protocol !== "https:") {
    throw new Error("SALESFORCE_WEB_TO_LEAD_URL は https のURLを指定してください");
  }
  // 日本語が文字化けしないよう、文字コードを明示する
  if (!endpoint.searchParams.has("encoding")) endpoint.searchParams.set("encoding", "UTF-8");

  return {
    orgId,
    endpoint,
    leadSource: env.SALESFORCE_LEAD_SOURCE?.trim() || undefined,
    fieldMap: parseFieldMap(env.SALESFORCE_FIELD_MAP),
    debugEmail: env.SALESFORCE_DEBUG_EMAIL?.trim() || undefined,
  };
}

function parseFieldMap(raw: string | undefined): SalesforceConfig["fieldMap"] {
  if (!raw?.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("SALESFORCE_FIELD_MAP がJSONとして読めません");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SALESFORCE_FIELD_MAP は {\"項目\": \"Salesforceの項目名\"} の形で指定してください");
  }
  const map: SalesforceConfig["fieldMap"] = {};
  for (const [key, field] of Object.entries(value)) {
    if (!(SALESFORCE_MAPPABLE_KEYS as readonly string[]).includes(key)) {
      throw new Error(`SALESFORCE_FIELD_MAP の「${key}」は対応付けできない項目です`);
    }
    if (typeof field !== "string" || !FIELD_NAME.test(field)) {
      throw new Error(`SALESFORCE_FIELD_MAP の「${key}」の項目名が正しくありません`);
    }
    map[key as SalesforceMappableKey] = field;
  }
  return map;
}

/** Web-to-Lead に送る項目 */
export function webToLeadFields(lead: Lead, config: SalesforceConfig): URLSearchParams {
  const { contact, summary } = lead;
  const fields = new URLSearchParams();
  fields.set("oid", config.orgId);
  // Web-to-Lead では姓が必須。氏名は1つの欄で受け付けているので、まとめて姓に入れる
  fields.set("last_name", contact.name);
  fields.set("company", contact.companyName);
  fields.set("email", contact.email);
  if (contact.phone) fields.set("phone", contact.phone);
  fields.set("description", leadDescription(lead));
  if (config.leadSource) fields.set("lead_source", config.leadSource);

  const values: Record<SalesforceMappableKey, string> = {
    industry: summary.industry,
    employees: summary.employees,
    annualSavedAmount: String(summary.annualSavedAmount),
    annualSavedHours: String(Math.round(summary.annualSavedHours)),
    readinessScore: String(summary.readinessScore),
    readinessLevel: summary.readinessLevel,
    topTasks: formatTopTasks(summary),
    message: contact.message,
  };
  for (const [key, field] of Object.entries(config.fieldMap)) {
    fields.set(field, values[key as SalesforceMappableKey]);
  }

  if (config.debugEmail) {
    fields.set("debug", "1");
    fields.set("debugEmail", config.debugEmail);
  }
  return fields;
}

export function salesforceAdapter(config: SalesforceConfig): LeadAdapter {
  return {
    name: "Salesforce Web-to-Lead",
    async send(lead) {
      const res = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: webToLeadFields(lead, config),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      await res.body?.cancel();
      if (!res.ok) {
        throw new Error(`Salesforce Web-to-Lead が HTTP ${res.status} を返しました`);
      }
    },
  };
}
