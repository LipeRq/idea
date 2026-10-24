import { describe, expect, it } from "vitest";
import { pushWithRetry } from "../src/line/api";
import { MAX_MESSAGES, MAX_TEXT_LENGTH, toTextMessages } from "../src/line/text";
import { fakeLine, lineError, texts } from "./helpers";

const MSG = [{ type: "text" as const, text: "こんにちは" }];
const noWait = { waitMs: () => 0 };

describe("pushWithRetry", () => {
  it("通信の失敗・5xx は同じ再送キーで送り直す", async () => {
    const line = fakeLine({ pushErrors: [new TypeError("fetch failed"), lineError(500)] });
    const keys: string[] = [];
    const push = line.push.bind(line);
    line.push = async (to, m, key) => {
      keys.push(key);
      return push(to, m, key);
    };
    await pushWithRetry(line, "U1", MSG, noWait);
    expect(line.pushes).toHaveLength(1);
    expect(new Set(keys).size).toBe(1);
    expect(keys).toHaveLength(3);
  });

  it("409(同じ再送キーで受け付け済み)は送れたものとして扱う", async () => {
    const line = fakeLine({ pushErrors: [lineError(409)] });
    await expect(pushWithRetry(line, "U1", MSG, noWait)).resolves.toBeUndefined();
  });

  it("400 は送り直さずに失敗する", async () => {
    const line = fakeLine({ pushErrors: [lineError(400)] });
    await expect(pushWithRetry(line, "U1", MSG, noWait)).rejects.toMatchObject({ status: 400 });
  });

  it("回数の上限までで諦める", async () => {
    const line = fakeLine({ pushErrors: [lineError(500), lineError(502), lineError(503)] });
    await expect(pushWithRetry(line, "U1", MSG, noWait)).rejects.toMatchObject({ status: 503 });
  });
});

describe("toTextMessages", () => {
  it("5つを超えるかたまりは最後の吹き出しにつなげ、空のかたまりは使わない", () => {
    const t = texts(toTextMessages(["1", "", "2", "3", "4", "5", "6"]));
    expect(t).toHaveLength(MAX_MESSAGES);
    expect(t[4]).toBe("5\n\n6");
  });

  it("長すぎる吹き出しは末尾を省略する", () => {
    const [m] = texts(toTextMessages(["あ".repeat(MAX_TEXT_LENGTH + 10)]));
    expect(m).toHaveLength(MAX_TEXT_LENGTH);
    expect(m.endsWith("(長いので省略しました)")).toBe(true);
  });
});
