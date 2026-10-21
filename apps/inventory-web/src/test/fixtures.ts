// 単体テスト用のファイル(解析エンジンのテスト用ヘルパーで作る。実在の顧客ファイルは使わない)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestModule } from "@engine-test/helpers/ovba";
import { SAMPLE_PROJECT } from "@engine-test/helpers/sampleVba";
import { buildXlsm } from "@engine-test/helpers/workbooks";

export const MARKER = {
  source: "機密マーカー7f3a",
  password: "unit-secret-42ab",
  apiKey: "sk-live-unitAbCdEf1234567890XyZ",
  email: "suzuki@example.co.jp",
  webhook: "https://hooks.slack.com/services/T0UNIT/B0UNIT/unitWebhookToken",
};

export const SECRET_MODULE: TestModule = {
  name: "通知連携",
  type: "standard",
  code: `Option Explicit
' ${MARKER.source} の連携処理(担当: ${MARKER.email})
Const DB_PASS = "${MARKER.password}"
Const API_KEY = "${MARKER.apiKey}"
Private Const WEBHOOK_URL As String = "${MARKER.webhook}"

Public Sub 通知を送る()
    MsgBox "${MARKER.source}"
End Sub`,
};

export const secretWorkbook = () => buildXlsm({ modules: [...SAMPLE_PROJECT.modules, SECRET_MODULE] });
export const plainWorkbook = () => buildXlsm(SAMPLE_PROJECT);

const ACCESS_DIR = join(__dirname, "../../../inventory/test/fixtures/access");
export const accessFixture = (name: string) => new Uint8Array(readFileSync(join(ACCESS_DIR, name)));

/** File の代わり(Worker の処理は arrayBuffer() と name だけを使う) */
export function fakeFile(bytes: Uint8Array, name: string): File {
  return { name, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer } as unknown as File;
}
