import { createHmac } from "node:crypto";
import { summaryLines } from "./summary";
import type { Lead, LeadAdapter } from "./types";

// Slack の Incoming Webhook、または任意のWebhook(JSON)へ送る。

const SEND_TIMEOUT_MS = 10_000;

export type WebhookFormat = "slack" | "json";

export type WebhookConfig = {
  url: URL;
  format: WebhookFormat;
  /** 設定すると、本文のHMAC-SHA256を X-Lead-Signature ヘッダーに付ける(受け側で検証できる) */
  secret?: string;
};

/** LEAD_WEBHOOK_URL がなければ null(このアダプターを使わない)。設定に誤りがあれば例外 */
export function webhookConfigFromEnv(env: NodeJS.ProcessEnv): WebhookConfig | null {
  const raw = env.LEAD_WEBHOOK_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LEAD_WEBHOOK_URL がURLとして読めません");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("LEAD_WEBHOOK_URL は http(s) のURLを指定してください");
  }
  const format = env.LEAD_WEBHOOK_FORMAT?.trim() || (url.hostname === "hooks.slack.com" ? "slack" : "json");
  if (format !== "slack" && format !== "json") {
    throw new Error("LEAD_WEBHOOK_FORMAT は slack か json を指定してください");
  }
  return { url, format, secret: env.LEAD_WEBHOOK_SECRET?.trim() || undefined };
}

// Slack の制御文字。<!channel> などで通知を乱発されないよう、入力された文字列に含まれていたら無効にする
function escapeSlack(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function slackText(lead: Lead): string {
  const { contact } = lead;
  return [
    "*AI導入診断から無料相談の申し込みがありました*",
    `会社名:${contact.companyName}`,
    `氏名:${contact.name}`,
    `メール:${contact.email}`,
    `電話:${contact.phone || "未記入"}`,
    "",
    "*相談したい内容*",
    contact.message,
    "",
    "*診断結果の要約*",
    ...summaryLines(lead.summary),
  ]
    .map(escapeSlack)
    .join("\n");
}

export function webhookBody(lead: Lead, format: WebhookFormat): string {
  if (format === "slack") return JSON.stringify({ text: slackText(lead) });
  return JSON.stringify({
    type: "lead.created",
    source: "ai-diagnosis",
    submittedAt: lead.submittedAt.toISOString(),
    contact: lead.contact,
    diagnosis: lead.summary,
  });
}

export function webhookAdapter(config: WebhookConfig): LeadAdapter {
  return {
    name: config.format === "slack" ? "Slack Webhook" : "Webhook",
    async send(lead) {
      const body = webhookBody(lead, config.format);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.secret) {
        headers["X-Lead-Signature"] =
          `sha256=${createHmac("sha256", config.secret).update(body).digest("hex")}`;
      }
      const res = await fetch(config.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      await res.body?.cancel();
      if (!res.ok) {
        throw new Error(`Webhook が HTTP ${res.status} を返しました`);
      }
    },
  };
}
