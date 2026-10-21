import { describe, expect, it } from "vitest";
import { describeFailure, type FailureCode } from "./errors";

const codes: FailureCode[] = ["unsupported", "encryptedAccess", "password", "corrupt", "limit", "readFailed", "internal", "timeout", "crashed", "loadFailed"];

describe("describeFailure(失敗の文言)", () => {
  it("すべてのコードに「何が起きたか」と「どうすればよいか」がある", () => {
    for (const code of codes) {
      const text = describeFailure({ code });
      expect(text.title.length, code).toBeGreaterThan(0);
      expect(text.hint.length, code).toBeGreaterThan(0);
    }
  });

  it("パスワード付き Access はコマンドライン版を案内しない", () => {
    const text = describeFailure({ code: "encryptedAccess", message: "パスワードで暗号化された Access データベースは、ブラウザ版では解析できません。コマンドライン版(--password)を使ってください" });
    expect(`${text.title}${text.hint}`).not.toContain("--password");
    expect(text.title).toContain("パスワード付きの Access ファイル");
  });

  it("上限超過は「zip 爆弾」などの怖い言葉を出さず、データの行を消したコピーを案内する", () => {
    for (const kind of ["partSize", "totalSize", "time", "inputSize"] as const) {
      const text = describeFailure({ code: "limit", kind, message: "zip 爆弾の可能性があります" });
      expect(`${text.title}${text.hint}`).not.toMatch(/爆弾/);
      expect(text.hint).toContain("データの行を消したコピー");
    }
  });

  it("読み込みの失敗・Worker の起動失敗・異常終了は、それぞれ別の対処を示す", () => {
    expect(describeFailure({ code: "readFailed" }).hint).toContain("共有フォルダ");
    expect(describeFailure({ code: "loadFailed" }).hint).toContain("再読み込み");
    expect(describeFailure({ code: "crashed" }).hint).toContain("メモリ");
  });

  it("暗号化されたブックは、パスワードを外す方法を案内する", () => {
    expect(describeFailure({ code: "unsupported", message: "暗号化されたブックは解析できません" }).hint).toContain("パスワードを外して");
  });
});
