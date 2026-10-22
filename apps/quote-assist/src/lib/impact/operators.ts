import type { Company } from "../domain/reference";

/** 引き合い登録で「この見積を作る人」に選べる名前。見積担当者(社長・工場長)、営業の窓口、その他 */
export function operatorOptions(company: Pick<Company, "quoteStaff" | "salesContact">): string[] {
  return [...new Set([...company.quoteStaff, company.salesContact, "その他の担当者"])];
}
