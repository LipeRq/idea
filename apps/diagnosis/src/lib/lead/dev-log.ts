import type { Lead, LeadAdapter } from "./types";

// 送信先が未設定の開発環境で、申し込みが届いたことだけをサーバーログで確かめるためのアダプター。
// 本番(NODE_ENV=production)では LEAD_LOG_ONLY=true のときしか使わない。どちらでも個人情報は伏せて出す。

function maskText(value: string): string {
  const chars = Array.from(value);
  return chars.length === 0 ? "" : `${chars[0]}${"*".repeat(Math.min(Math.max(chars.length - 1, 1), 4))}`;
}

function maskEmail(value: string): string {
  const [local = "", domain = ""] = value.split("@");
  return `${maskText(local)}@${maskText(domain)}`;
}

export function maskContact(contact: Lead["contact"]) {
  return {
    companyName: maskText(contact.companyName),
    name: maskText(contact.name),
    email: maskEmail(contact.email),
    phone: contact.phone ? "(記入あり)" : "(未記入)",
    message: `(${Array.from(contact.message).length}文字)`,
  };
}

export const devLogAdapter: LeadAdapter = {
  name: "サーバーログ(開発用)",
  async send(lead) {
    console.info(
      "[lead] 送信先が未設定のため、申し込みをサーバーログに出力します(個人情報は伏せています)",
      JSON.stringify({
        submittedAt: lead.submittedAt.toISOString(),
        contact: maskContact(lead.contact),
        summary: lead.summary,
      }),
    );
  },
};
