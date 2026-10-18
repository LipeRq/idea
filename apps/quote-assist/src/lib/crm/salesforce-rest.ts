import { CrmError, type CrmConnector } from "./types";

// Salesforce REST API の本番実装。環境変数がそろったときだけ使う(lib/crm/index.ts)。
// 認証は OAuth 2.0 クライアントクレデンシャルフロー(接続アプリケーションに実行ユーザーを設定しておく)。
// ※この環境では実際の組織への接続は確認していない。

export type SalesforceConfig = {
  instanceUrl: string;
  clientId: string;
  clientSecret: string;
};

const TIMEOUT_MS = 30_000;

type CompositeResponse = {
  compositeResponse: {
    referenceId: string;
    httpStatusCode: number;
    body: { id?: string; success?: boolean } | { errorCode?: string; message?: string }[] | null;
  }[];
};

export function createSalesforceRest(config: SalesforceConfig, fetchImpl: typeof fetch = fetch): CrmConnector {
  const base = config.instanceUrl.replace(/\/+$/, "");

  async function token(): Promise<{ accessToken: string; instanceUrl: string }> {
    const res = await fetchImpl(`${base}/services/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new CrmError("Salesforceの認証に失敗しました", [`token_${res.status}`]);
    const body = (await res.json()) as { access_token?: string; instance_url?: string };
    if (!body.access_token) throw new CrmError("Salesforceの認証に失敗しました", ["token_missing"]);
    return { accessToken: body.access_token, instanceUrl: (body.instance_url ?? base).replace(/\/+$/, "") };
  }

  return {
    provider: "salesforce",
    label: "Salesforce",
    async register(payload) {
      const { accessToken, instanceUrl } = await token();
      const url = payload.composite.compositeRequest[0].url.replace(/\/sobjects\/.*$/, "/composite");
      const res = await fetchImpl(`${instanceUrl}${url}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload.composite),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new CrmError("Salesforceへの登録に失敗しました", [`composite_${res.status}`]);
      const body = (await res.json()) as CompositeResponse;
      const byRef = new Map(body.compositeResponse.map((r) => [r.referenceId, r]));
      const failed = body.compositeResponse.filter((r) => r.httpStatusCode >= 400);
      if (failed.length > 0) {
        // エラーコードだけを残す(メッセージには項目の値が含まれることがある)
        const codes = failed.flatMap((r) =>
          Array.isArray(r.body) ? r.body.map((e) => e.errorCode ?? "UNKNOWN") : [`HTTP_${r.httpStatusCode}`],
        );
        throw new CrmError("Salesforceへの登録に失敗しました(商談・見積とも作成していません)", codes);
      }
      const idOf = (ref: string) => {
        const b = byRef.get(ref)?.body;
        return b && !Array.isArray(b) && "id" in b && b.id ? b.id : null;
      };
      const opportunityId = idOf("opportunity");
      const quoteId = idOf("quote");
      if (!opportunityId || !quoteId) throw new CrmError("Salesforceの応答を解析できませんでした");
      return {
        opportunityId,
        quoteId,
        opportunityUrl: `${instanceUrl}/lightning/r/Opportunity/${opportunityId}/view`,
      };
    },
  };
}
