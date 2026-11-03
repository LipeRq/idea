// CSV の列の定義。CSV の書き出しと、Data 360 の Ingestion API に登録するスキーマ(OpenAPI 形式の YAML)の両方をここから作る。
// 列を足すときはここだけを直せば、CSV とスキーマがずれない。

export type ColumnType = "string" | "number" | "boolean" | "date" | "datetime";

export interface Column {
  name: string;
  type: ColumnType;
  description: string;
}

export interface TableDef {
  /** Ingestion API のオブジェクト名(英小文字とアンダースコア) */
  name: string;
  /** data/ からの相対パス */
  file: string;
  label: string;
  primaryKey: string;
  /** エンゲージメント(行動の記録)なら、その発生日時の列 */
  eventTime?: string;
  category: "Profile" | "Engagement" | "Other";
  columns: Column[];
}

const s = (name: string, description: string): Column => ({ name, type: "string", description });
const n = (name: string, description: string): Column => ({ name, type: "number", description });
const b = (name: string, description: string): Column => ({ name, type: "boolean", description });
const d = (name: string, description: string): Column => ({ name, type: "date", description });
const t = (name: string, description: string): Column => ({ name, type: "datetime", description });

export const TABLES = {
  ecCustomers: {
    name: "ec_customers",
    file: "ec/customers.csv",
    label: "EC会員",
    primaryKey: "member_id",
    category: "Profile",
    columns: [
      s("member_id", "EC会員ID(MCE の購読者キーにも使う)"),
      s("last_name", "姓"),
      s("first_name", "名"),
      s("last_name_kana", "姓(カナ)"),
      s("first_name_kana", "名(カナ)"),
      s("email", "メールアドレス"),
      s("phone", "電話番号(ハイフンあり)"),
      s("prefecture", "都道府県"),
      n("birth_year", "生まれた年(任意入力)"),
      t("registered_at", "会員登録日時"),
      b("email_opt_in", "メールマガジンの受け取りに同意しているか(現在の状態)"),
      t("email_opt_in_at", "同意した日時"),
      t("email_opt_out_at", "配信停止した日時"),
      t("updated_at", "最終更新日時"),
    ],
  },
  products: {
    name: "products",
    file: "ec/products.csv",
    label: "商品",
    primaryKey: "product_id",
    category: "Other",
    columns: [
      s("product_id", "商品コード"),
      s("name", "商品名"),
      s("category", "茶の種類(Sencha など。Salesforce の選択リストの API 名と同じ)"),
      s("category_label", "茶の種類(表示名)"),
      n("price", "税込の定価(円)"),
      b("gift_eligible", "ギフト対応か"),
      b("noshi_available", "のし対応か"),
      s("gift_occasions", "対応する用途(; 区切り)"),
      s("caffeine_level", "カフェインの区分(Low はカフェインレス加工品だけ)"),
      n("shelf_life_days", "賞味期限の目安(日)"),
      b("is_active", "販売中か"),
      s("product_url", "商品ページの URL"),
      s("image_url", "商品画像の URL"),
    ],
  },
  ecOrders: {
    name: "ec_orders",
    file: "ec/orders.csv",
    label: "EC注文",
    primaryKey: "order_id",
    eventTime: "ordered_at",
    category: "Engagement",
    columns: [
      s("order_id", "注文番号"),
      s("member_id", "EC会員ID"),
      t("ordered_at", "注文日時"),
      b("is_gift", "ギフト注文か"),
      s("gift_occasion", "ギフトの用途(Ochugen など)"),
      n("destinations_count", "送り先の数"),
      b("noshi", "のしの指定があるか"),
      n("subtotal", "商品の合計(円)"),
      n("shipping_fee", "送料(円)"),
      n("discount", "値引き(円)"),
      n("total", "支払い合計(円)"),
      s("coupon_code", "使ったクーポン"),
      s("status", "completed または cancelled"),
    ],
  },
  ecOrderItems: {
    name: "ec_order_items",
    file: "ec/order_items.csv",
    label: "EC注文明細",
    primaryKey: "order_item_id",
    eventTime: "ordered_at",
    category: "Engagement",
    columns: [
      s("order_item_id", "明細ID(注文番号-行番号)"),
      s("order_id", "注文番号"),
      n("line_no", "行番号"),
      s("product_id", "商品コード"),
      n("quantity", "数量"),
      n("unit_price", "単価(円)"),
      n("amount", "金額(円)"),
      t("ordered_at", "注文日時(注文と同じ)"),
    ],
  },
  posMembers: {
    name: "pos_members",
    file: "pos/members.csv",
    label: "店舗会員",
    primaryKey: "card_no",
    category: "Profile",
    columns: [
      s("card_no", "店舗会員番号"),
      s("last_name", "姓(申込書の記入どおり。異体字のことがある)"),
      s("first_name", "名"),
      s("last_name_kana", "姓(カナ)"),
      s("first_name_kana", "名(カナ)"),
      s("email", "メールアドレス(任意。記入の揺れあり)"),
      s("phone", "電話番号(記入の揺れあり)"),
      s("linked_ec_member_id", "アプリで連携済みの EC会員ID"),
      b("email_opt_in", "メールの受け取りに同意しているか"),
      s("home_store_id", "入会した店舗"),
      t("joined_at", "入会日時"),
      t("updated_at", "最終更新日時"),
    ],
  },
  posTransactions: {
    name: "pos_transactions",
    file: "pos/transactions.csv",
    label: "店舗購買",
    primaryKey: "transaction_id",
    eventTime: "purchased_at",
    category: "Engagement",
    columns: [
      s("transaction_id", "取引番号"),
      s("card_no", "店舗会員番号"),
      s("store_id", "店舗(S01 本店・S02 駅前店。いずれも架空)"),
      t("purchased_at", "購入日時"),
      n("total", "支払い合計(円)"),
      n("items_count", "明細の行数"),
    ],
  },
  posTransactionItems: {
    name: "pos_transaction_items",
    file: "pos/transaction_items.csv",
    label: "店舗購買明細",
    primaryKey: "transaction_item_id",
    eventTime: "purchased_at",
    category: "Engagement",
    columns: [
      s("transaction_item_id", "明細ID(取引番号-行番号)"),
      s("transaction_id", "取引番号"),
      n("line_no", "行番号"),
      s("product_id", "商品コード"),
      n("quantity", "数量"),
      n("unit_price", "単価(円)"),
      n("amount", "金額(円)"),
      t("purchased_at", "購入日時(取引と同じ)"),
    ],
  },
  webEvents: {
    name: "web_events",
    file: "engagement/web_events.csv",
    label: "ECサイトの行動",
    primaryKey: "event_id",
    eventTime: "occurred_at",
    category: "Engagement",
    columns: [
      s("event_id", "イベントID"),
      s("device_id", "端末ID(Cookie)"),
      s("member_id", "ログイン中なら EC会員ID"),
      s("event_type", "page_view / product_view / add_to_cart / purchase / login"),
      s("page_type", "home / category / product / gift / cart / order_complete"),
      s("product_id", "商品コード"),
      s("order_id", "注文番号(purchase のとき)"),
      n("quantity", "数量(add_to_cart のとき)"),
      t("occurred_at", "発生日時"),
    ],
  },
  emailEvents: {
    name: "email_events",
    file: "engagement/email_events.csv",
    label: "メールの反応",
    primaryKey: "event_id",
    eventTime: "occurred_at",
    category: "Engagement",
    columns: [
      s("event_id", "イベントID"),
      s("subscriber_key", "購読者キー(EC会員ID)"),
      s("email_name", "メールの名前(NL_ はメールマガジン、JB_ はジャーニー)"),
      s("event_type", "sent / open / click / bounce / unsubscribe"),
      s("link_url", "クリックしたリンク"),
      t("occurred_at", "発生日時"),
    ],
  },
} satisfies Record<string, TableDef>;

/** Data 360 の Ingestion API コネクタに登録するスキーマ(OpenAPI 3.0 の YAML) */
export function ingestionSchemaYaml(tables: TableDef[]): string {
  const lines = [
    "# しずく茶舗(架空)の Ingestion API スキーマ。scripts/generate-data.ts が tables.ts から生成する(手で書き換えない)。",
    "# Data 360 の「Ingestion API」コネクタにこのファイルをアップロードし、オブジェクトごとにデータストリームを作る。",
    "openapi: 3.0.3",
    "components:",
    "  schemas:",
  ];
  for (const table of tables) {
    lines.push(`    ${table.name}:`);
    lines.push("      type: object");
    lines.push("      properties:");
    for (const col of table.columns) {
      lines.push(`        ${col.name}:`);
      if (col.type === "datetime") {
        lines.push("          type: string", "          format: date-time");
      } else if (col.type === "date") {
        lines.push("          type: string", "          format: date");
      } else {
        lines.push(`          type: ${col.type}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

type Cell = string | number | boolean | null | undefined;

function cell(value: Cell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(table: TableDef, rows: Record<string, Cell>[]): string {
  const names = table.columns.map((col) => col.name);
  const out = [names.join(",")];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!names.includes(key)) throw new Error(`${table.file}: 定義にない列 ${key}`);
    }
    out.push(names.map((name) => cell(row[name])).join(","));
  }
  return `${out.join("\n")}\n`;
}
