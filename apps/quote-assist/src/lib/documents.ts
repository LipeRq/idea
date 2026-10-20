import type { Company, Customer, RateTable } from "./domain/reference";
import type { Inquiry } from "./domain/inquiry";
import { addBusinessDays, addDays, businessDaysBetween, formatJpDate, todayJst } from "./dates";
import { formatYen } from "./format";
import { calculateQuote } from "./quote/calculate";
import { roundProduct } from "./quote/decimal";

// 見積書・回答メールの内容。金額は承認時のスナップショット(未承認なら現在の入力からの計算)を使う。

export type QuoteDocument = {
  approved: boolean;
  quoteNumber: string;
  issuedOn: string;
  validUntil: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  tax: number;
  totalWithTax: number;
  standardLeadDays: number;
  /** 受付日から標準リードタイムで納められる日 */
  earliestDelivery: string;
  dueDate: string | null;
  meetsDueDate: boolean | null;
  expedite: boolean;
  tiers: { quantity: number; unitPrice: number; total: number }[];
  includes: string[];
};

export function buildQuoteDocument(inquiry: Inquiry, rates: RateTable, now = new Date()): QuoteDocument | null {
  const input = inquiry.approved?.input ?? inquiry.quote?.input;
  if (!input) return null;
  const calc = inquiry.approved ? null : calculateQuote(input, rates);
  const unitPrice = inquiry.approved?.unitPrice ?? calc!.unitPrice;
  const subtotal = inquiry.approved?.total ?? calc!.total;
  const lead = inquiry.approved?.standardLeadDays ?? calc!.standardLeadDays;
  const issuedOn = todayJst(inquiry.approved ? new Date(inquiry.approved.at) : now);
  const received = todayJst(new Date(inquiry.createdAt));
  // 消費税は円未満切り捨て。掛け算は10進で行う(見積明細と同じ)
  const tax = Math.floor(roundProduct([subtotal, rates.rules.taxRate], 6));
  const dueDate = inquiry.extraction.spec.dueDate;
  const earliestDelivery = addBusinessDays(received, lead);
  const treatmentNames = input.treatments
    .map((t) => rates.treatments.find((x) => x.id === t.treatmentId)?.name)
    .filter((n): n is string => Boolean(n));
  return {
    approved: inquiry.approved !== null,
    quoteNumber: inquiry.approved?.quoteNumber ?? "(承認後に採番)",
    issuedOn,
    validUntil: addDays(issuedOn, rates.rules.quoteValidityDays),
    quantity: input.quantity,
    unitPrice,
    subtotal,
    tax,
    totalWithTax: subtotal + tax,
    standardLeadDays: lead,
    earliestDelivery,
    dueDate,
    meetsDueDate: dueDate ? input.expedite || businessDaysBetween(received, dueDate) >= lead : null,
    expedite: input.expedite,
    tiers: inquiry.approved?.tiers ?? calc!.tiers,
    includes: [
      `材料費(${input.material.materialId})`,
      "加工費",
      ...(treatmentNames.length ? [`${treatmentNames.join("・")}(外注)`] : []),
      ...(input.expedite ? ["特急対応"] : []),
    ],
  };
}

export function buildReplyEmail(args: {
  inquiry: Inquiry;
  doc: QuoteDocument;
  company: Company;
  customer: Customer | null;
}): string {
  const { inquiry, doc, company } = args;
  const spec = inquiry.extraction.spec;
  const to = `${args.customer?.name ?? spec.customerName ?? "ご担当者"} ${spec.contactName ? `${spec.contactName}様` : "様"}`;
  const part = `${spec.partName ?? "ご依頼の部品"}${spec.drawingNumber ? `(${spec.drawingNumber}${spec.revision ? ` Rev.${spec.revision}` : ""})` : ""}`;
  const delivery = doc.dueDate
    ? doc.meetsDueDate
      ? doc.expedite
        ? `ご希望の${formatJpDate(doc.dueDate)}に向けて特急対応で調整いたします(確定納期は受注時にご連絡いたします)`
        : `ご希望の${formatJpDate(doc.dueDate)}に納入できる見込みです(確定納期は受注時にご連絡いたします)`
      : `ご希望の${formatJpDate(doc.dueDate)}は難しく、最短で${formatJpDate(doc.earliestDelivery)}頃となります`
    : `受注後 約${doc.standardLeadDays}営業日`;
  const questions = inquiry.extraction.questions;
  const sender = company.salesContact.split(" ").pop();
  return `${to}

いつもお世話になっております。${company.name}の${sender}です。
${part}のお見積りをお送りいたします。

・見積番号:${doc.quoteNumber}
・数量:${doc.quantity.toLocaleString("ja-JP")}個
・単価:${formatYen(doc.unitPrice)}(税抜)
・合計:${formatYen(doc.subtotal)}(税抜、消費税込み ${formatYen(doc.totalWithTax)})
・納期:${delivery}
・有効期限:${formatJpDate(doc.validUntil)}
${
  questions.length > 0
    ? `
あわせて、下記の点をご確認いただけますでしょうか。ご回答の内容により、金額・納期が変わる場合がございます。
${questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}
`
    : ""
}
ご不明な点がございましたら、お気軽にお問い合わせください。
よろしくお願いいたします。

${company.name} ${company.salesContact}
${company.phone}`;
}
