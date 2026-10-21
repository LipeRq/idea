// E2E で使うファイルを、解析エンジンのテスト用ヘルパーで作る(実在の顧客ファイルは使えないため)。
// 出力先は e2e/.fixtures/(gitignore)。
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestModule } from "../../inventory/test/helpers/ovba";
import { SAMPLE_PROJECT } from "../../inventory/test/helpers/sampleVba";
import { buildXlsm } from "../../inventory/test/helpers/workbooks";
import { ACCESS_FIXTURES, FIXTURE_DIR, FIXTURES, MARKER } from "./constants";

/** 目印・ダミーのパスワード・伏せ字にならない秘密(APIキー・Webhook・メールアドレス)を含むモジュール */
const SECRET_MODULE: TestModule = {
  name: "通知連携",
  type: "standard",
  code: `Option Explicit
' ${MARKER.source} の連携処理(担当: ${MARKER.email})
Const DB_PASS = "${MARKER.password}"
Const API_KEY = "${MARKER.apiKey}"
Private Const WEBHOOK_URL As String = "${MARKER.webhook}"

Public Sub 通知を送る()
    Dim http As Object
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "POST", WEBHOOK_URL, False
    http.setRequestHeader "Authorization", "Bearer " & API_KEY
    http.send "{""text"":""${MARKER.source}""}"
End Sub`,
};

export default function globalSetup() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const good = buildXlsm({ modules: [...SAMPLE_PROJECT.modules, SECRET_MODULE] });
  writeFileSync(join(FIXTURE_DIR, FIXTURES.secret), good);
  // 2件続けて解析するとき用(同じ中身・別の名前)
  writeFileSync(join(FIXTURE_DIR, FIXTURES.second), buildXlsm(SAMPLE_PROJECT));
  // 途中で切れた .xlsm(zip の中央ディレクトリが無い)
  writeFileSync(join(FIXTURE_DIR, FIXTURES.truncated), good.slice(0, Math.floor(good.length / 2)));
  // 拡張子だけ .xlsm のランダムなバイト列(乱数の種を固定)
  const random = new Uint8Array(64 * 1024);
  let seed = 0x7f3a;
  for (let i = 0; i < random.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    random[i] = seed >>> 24;
  }
  writeFileSync(join(FIXTURE_DIR, FIXTURES.random), random);
  // 対応していない形式(中身は読まずに断る)
  writeFileSync(join(FIXTURE_DIR, FIXTURES.docx), new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));

  for (const [name, source] of Object.entries(ACCESS_FIXTURES)) copyFileSync(source, join(FIXTURE_DIR, name));
}
