import type { Company, Customer, RateTable } from "../domain/reference";
import type { Inquiry } from "../domain/inquiry";
import { addDays, todayJst } from "../dates";
import { formatYen } from "../format";

// 承認済みの見積から、Salesforce の商談(Opportunity)と見積(Quote)を作るリクエストを組み立てる。
// Composite API(allOrNone)で1回に送り、途中で失敗したらどちらも作られないようにする。
// 見積品目(QuoteLineItem)は価格表・商品の設定が組織ごとに違うため、MVPでは明細を説明欄に入れる。

export type SalesforceOptions = {
  apiVersion: string;
  stageName: string;
};

export type CompositeSubrequest = {
  method: "POST";
  url: string;
  referenceId: "opportunity" | "quote";
  body: Record<string, unknown>;
};

export type SalesforcePayload = {
  opportunity: Record<string, unknown>;
  quote: Record<string, unknown>;
  composite: { allOrNone: true; compositeRequest: CompositeSubrequest[] };
};

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function buildSalesforcePayload(args: {
  inquiry: Inquiry;
  customer: Customer | null;
  company: Company;
  rates: RateTable;
  options: SalesforceOptions;
}): SalesforcePayload {
  const { inquiry, customer, options } = args;
  const approved = inquiry.approved;
  if (!approved) throw new Error("承認されていない見積はCRMに登録できません");
  const spec = inquiry.extraction.spec;
  const part = [spec.partName, spec.drawingNumber && `${spec.drawingNumber}${spec.revision ? ` Rev.${spec.revision}` : ""}`]
    .filter(Boolean)
    .join(" ");
  const customerLabel = customer?.shortName ?? spec.customerName ?? "顧客未確定";
  const expiration = addDays(todayJst(new Date(approved.at)), args.rates.rules.quoteValidityDays);

  const opportunity: Record<string, unknown> = {
    Name: clip(`${customerLabel} ${part || "部品加工"} ×${approved.input.quantity}`, 120),
    StageName: options.stageName,
    CloseDate: expiration,
    Amount: approved.total,
    Description: clip(
      [
        `見積アシストで作成(引き合いID ${inquiry.id})`,
        `見積番号:${approved.quoteNumber}`,
        `品名・図番:${part || "未確定"}`,
        `材質:${approved.input.material.materialId} / 数量:${approved.input.quantity}個`,
        `希望納期:${spec.dueDate ?? "未確定"} / 標準リードタイム:${approved.standardLeadDays}営業日`,
        inquiry.extraction.questions.length > 0
          ? `顧客への確認事項(${inquiry.extraction.questions.length}件):\n${inquiry.extraction.questions.map((q) => `- ${q.question}`).join("\n")}`
          : "顧客への確認事項:なし",
      ].join("\n"),
      32_000,
    ),
  };
  // 取引先が対応づいている顧客だけ AccountId を入れる(新規顧客は商談だけ作り、取引先は人が紐づける)
  if (customer?.salesforceAccountId) opportunity.AccountId = customer.salesforceAccountId;

  const lines = approved.lines.map((l) => `${l.label}:${formatYen(l.amount)}(${l.basis})`);
  const tiers = approved.tiers.map((t) => `${t.quantity}個:単価${formatYen(t.unitPrice)}`);
  const quote: Record<string, unknown> = {
    Name: approved.quoteNumber,
    OpportunityId: "@{opportunity.id}",
    ExpirationDate: expiration,
    Description: clip(
      [
        `見積金額(税抜):${formatYen(approved.total)}(単価${formatYen(approved.unitPrice)} × ${approved.input.quantity}個)`,
        `単価表:${approved.rateTableId}`,
        "",
        "見積明細:",
        ...lines,
        "",
        `数量別単価:${tiers.join(" / ")}`,
        `発行:${args.company.name} ${args.company.salesContact}`,
      ].join("\n"),
      32_000,
    ),
  };

  const base = `/services/data/${options.apiVersion}/sobjects`;
  return {
    opportunity,
    quote,
    composite: {
      allOrNone: true,
      compositeRequest: [
        { method: "POST", url: `${base}/Opportunity`, referenceId: "opportunity", body: opportunity },
        { method: "POST", url: `${base}/Quote`, referenceId: "quote", body: quote },
      ],
    },
  };
}
