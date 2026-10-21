// 解析の失敗を、利用者に見せる文言にする。エンジンのメッセージは日本語なので基本はそのまま使い、対処を足す。
// 「zip 爆弾」のような、利用者を不安にさせる言葉は画面に出さない(上限超過は自前の文言にする)。
import type { LimitKind } from "@engine/browser";
import type { WorkerErrorCode } from "@/worker/protocol";

export type FailureCode = WorkerErrorCode | "timeout" | "crashed" | "loadFailed";

export interface Failure {
  code: FailureCode;
  message?: string;
  kind?: LimitKind;
}

export interface FailureText {
  title: string;
  hint: string;
}

const DATA_HINT = "マクロの解析にデータは不要です。データの行を消したコピーを保存してお試しください。";

function limitText(kind: LimitKind | undefined, message: string | undefined): FailureText {
  switch (kind) {
    case "time":
      return { title: "解析が制限時間を超えたため中止しました。", hint: `ファイルが極端に大きい・複雑な可能性があります。${DATA_HINT}` };
    case "partSize":
    case "totalSize":
      return { title: "ファイルの中身を展開すると大きすぎるため、解析を中止しました。", hint: DATA_HINT };
    case "entryCount":
      return { title: "ファイルの中の部品の数が多すぎるため、解析を中止しました。", hint: "Excel / Access で開いて保存し直すと解析できることがあります。" };
    case "inputSize":
      return { title: "ファイルが大きすぎます。", hint: DATA_HINT };
    default:
      return { title: message || "上限を超えたため解析を中止しました。", hint: DATA_HINT };
  }
}

export function describeFailure(f: Failure): FailureText {
  switch (f.code) {
    case "encryptedAccess":
      return {
        title: "パスワード付きの Access ファイルは、この画面では解析できません。",
        hint: "Access でパスワードを解除して別名で保存してから読み込むか、ご相談ください。",
      };
    case "unsupported":
      return {
        title: f.message || "対応していないファイルです。",
        hint: /暗号化されたブック/.test(f.message ?? "")
          ? "Excel でパスワードを外して保存し直すと解析できます。"
          : "Excel / Access で開ける場合は、対応している形式(.xlsm・.xlsb・.xls・.accdb など)で保存し直してからお試しください。",
      };
    case "password":
      return { title: "パスワードが必要なファイルのため解析できません。", hint: "パスワードを外して保存し直してからお試しください。" };
    case "corrupt":
      return { title: f.message || "ファイルが壊れているため解析できませんでした。", hint: "Excel / Access で開いて保存し直すと解析できることがあります。" };
    case "limit":
      return limitText(f.kind, f.message);
    case "readFailed":
      return {
        title: "ファイルを開けませんでした。",
        hint: "共有フォルダの接続や、別のアプリで編集中でないかを確認し、デスクトップにコピーしてからお試しください。",
      };
    case "timeout":
      return { title: "解析が時間内に終わらなかったため中止しました。", hint: `ファイルが極端に大きい・複雑な可能性があります。${DATA_HINT}` };
    case "crashed":
      return {
        title: "解析中に問題が起きました。",
        hint: "ブラウザのメモリが足りない可能性があります。他のタブを閉じるか、データの行を消したコピーでお試しください。",
      };
    case "loadFailed":
      return { title: "解析プログラムを読み込めませんでした。", hint: "ページを再読み込みしてください。" };
    case "internal":
      return { title: "解析できませんでした。", hint: "想定していない問題が起きました。別のファイルでお試しいただくか、ご相談ください。" };
  }
}
