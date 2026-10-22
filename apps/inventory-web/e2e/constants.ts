import { join } from "node:path";

export const FIXTURE_DIR = join(__dirname, ".fixtures");
export const LOG_DIR = join(__dirname, ".logs");
const ENGINE_ACCESS = join(__dirname, "../../inventory/test/fixtures/access");

/** テスト用ファイルに入れる目印。送信内容・URL・ログに出てはいけないもの/出てよいものを確かめる */
export const MARKER = {
  /** ソースコードに入れる目印(AI 版で同意した場合だけ送られる) */
  source: "機密マーカー7f3a",
  /** ダミーのパスワード(エンジンが伏せ字にする。どこにも出てはいけない) */
  password: "e2e-secret-9b1d",
  /** 伏せ字にならない秘密(同意画面で「そのまま送られる」と示す) */
  apiKey: "sk-live-e2eAbCdEf1234567890XyZ",
  webhook: "https://hooks.slack.com/services/T0E2E/B0E2E/e2eWebhookToken",
  email: "yamada@example.co.jp",
  /** テスト用ブックの文書プロパティ(apps/inventory/test/helpers/workbooks.ts) */
  creator: "山田太郎",
  lastModifiedBy: "佐藤花子",
  company: "株式会社サンプル商事",
};

export const FIXTURES = {
  secret: "顧客台帳_e2e.xlsm",
  second: "売上管理_e2e.xlsm",
  /** 他のブック・Access・DB を参照するブック(複数ファイルの関係図の確認用。second・access と名前が一致する) */
  linker: "連携元_e2e.xlsm",
  /** モジュール300・処理4,500ほどの大きな結果(画面が固まらないことの確認用) */
  large: "大規模_e2e.xlsm",
  truncated: "壊れたブック.xlsm",
  random: "ランダム.xlsm",
  docx: "議事録.docx",
  access: "queryTestV2010.accdb",
  passwordAccess: "V2010_with-password.accdb",
  /** フォーム・レポートの内部のクエリ(~sq_)を含む Access */
  hiddenQueryAccess: "odbcLinkerTestV2007.accdb",
} as const;

export const ACCESS_FIXTURES: Record<string, string> = {
  [FIXTURES.access]: join(ENGINE_ACCESS, "queryTestV2010.accdb"),
  [FIXTURES.passwordAccess]: join(ENGINE_ACCESS, "V2010_with-password.accdb"),
  [FIXTURES.hiddenQueryAccess]: join(ENGINE_ACCESS, "odbcLinkerTestV2007.accdb"),
};

export const fixturePath = (name: string) => join(FIXTURE_DIR, name);
