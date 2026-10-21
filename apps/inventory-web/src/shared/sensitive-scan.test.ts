import { describe, expect, it } from "vitest";
import { analyzeBuffer } from "@engine/browser";
import { buildXlsm } from "@engine-test/helpers/workbooks";
import { scanSensitive, type SensitiveKind } from "./sensitive-scan";

// 伏せ字にならない(エンジンのパスワード検出の対象外の)秘密を書いたモジュール
const CODE = `Option Explicit
Const CW_KEY = "a1b2c3d4e5f6a7b8c9d0"
Private Const LINE_TOKEN As String = "tokenValue12345"
Const AWS_ID = "AKIAIOSFODNN7EXAMPLE"
Const GOOGLE = "AIzaSyA1234567890abcdefghijklmnopqrstu"
Public Sub メール送信()
    Dim cfg As Object
    cfg.Fields.Item(cdoSendPassword) = "cdoPass77"
    cfg.Fields.Item("http://schemas.microsoft.com/cdo/configuration/sendusername") = "user1"
    ' 担当: tanaka@example.co.jp / 03-1234-5678
    Dim s As String
    s = "tokenize this"
End Sub`;

function scan(code: string) {
  const report = analyzeBuffer(buildXlsm({ modules: [{ name: "連携", type: "standard", code }] }), "a.xlsm");
  return scanSensitive(report);
}

const has = (hits: { kind: SensitiveKind; excerpt: string }[], kind: SensitiveKind, text: string) =>
  hits.some((h) => h.kind === kind && h.excerpt.includes(text));

describe("scanSensitive(伏せ字にならない秘密の検出)", () => {
  const { hits } = scan(CODE);

  it("cdoSendPassword のような複合名の代入を検出する(値ごと送られる)", () => {
    expect(has(hits, "secretKeyword", 'Item(cdoSendPassword) = "cdoPass77"')).toBe(true);
  });

  it("名前が …_KEY / …Token の変数・定数への文字列の代入を検出する", () => {
    expect(has(hits, "namedSecret", 'CW_KEY = "a1b2c3d4e5f6a7b8c9d0"')).toBe(true);
    expect(has(hits, "namedSecret", "LINE_TOKEN")).toBe(true);
  });

  it("よく知られたキーの形(AWS・Google)を検出する", () => {
    expect(has(hits, "knownKey", "AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(has(hits, "knownKey", "AIzaSyA1234567890")).toBe(true);
  });

  it("メールアドレス・電話番号を検出し、場所(モジュール名と行)を付ける", () => {
    const email = hits.find((h) => h.kind === "email");
    expect(email?.match).toBe("tanaka@example.co.jp");
    expect(email?.location).toMatch(/^連携 \d+行目$/);
    expect(hits.some((h) => h.kind === "phone" && h.match === "03-1234-5678")).toBe(true);
  });

  it("後ろに小文字が続く語(tokenize など)は語の一致として出さない", () => {
    expect(hits.some((h) => h.kind === "secretKeyword" && h.excerpt.includes("tokenize"))).toBe(false);
  });

  it("秘密の無いコードでは何も出さない", () => {
    expect(scan(`Public Sub 集計()\n    Range("A1").Value = 1\nEnd Sub`).total).toBe(0);
  });
});
