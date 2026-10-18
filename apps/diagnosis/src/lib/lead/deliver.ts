import { devLogAdapter } from "./dev-log";
import { salesforceAdapter, salesforceConfigFromEnv } from "./salesforce";
import type { Lead, LeadAdapter } from "./types";
import { webhookAdapter, webhookConfigFromEnv } from "./webhook";

// 申し込みの送信先を環境変数から選ぶ。Salesforce と Webhook は両方設定すれば両方に送る
// (例:Salesforce にリードを作り、Slack で通知する)。どちらもなければ開発用のログに出す。

export type DeliveryOutcome = "sent" | "not_configured" | "failed";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function configuredAdapters(env: NodeJS.ProcessEnv = process.env): {
  adapters: LeadAdapter[];
  configErrors: string[];
} {
  const adapters: LeadAdapter[] = [];
  const configErrors: string[] = [];
  const factories = [
    () => {
      const config = salesforceConfigFromEnv(env);
      return config && salesforceAdapter(config);
    },
    () => {
      const config = webhookConfigFromEnv(env);
      return config && webhookAdapter(config);
    },
  ];
  for (const create of factories) {
    try {
      const adapter = create();
      if (adapter) adapters.push(adapter);
    } catch (error) {
      configErrors.push(errorMessage(error));
    }
  }
  const devLogAllowed = env.NODE_ENV !== "production" || env.LEAD_LOG_ONLY === "true";
  if (adapters.length === 0 && configErrors.length === 0 && devLogAllowed) {
    adapters.push(devLogAdapter);
  }
  return { adapters, configErrors };
}

/** 設定されたすべての送信先に送る。1つでも届けば "sent"。ログには個人情報を出さない */
export async function deliverLead(
  lead: Lead,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeliveryOutcome> {
  const { adapters, configErrors } = configuredAdapters(env);
  for (const message of configErrors) {
    console.error(`申し込みの送信先の設定に誤りがあります:${message}`);
  }
  if (adapters.length === 0) {
    if (configErrors.length > 0) return "failed";
    console.error(
      "申し込みの送信先が設定されていません(SALESFORCE_ORG_ID または LEAD_WEBHOOK_URL を設定してください)",
    );
    return "not_configured";
  }

  const results = await Promise.allSettled(adapters.map((a) => a.send(lead)));
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`申し込みの送信に失敗しました(${adapters[i].name}):${errorMessage(r.reason)}`);
    }
  });
  return results.some((r) => r.status === "fulfilled") ? "sent" : "failed";
}
