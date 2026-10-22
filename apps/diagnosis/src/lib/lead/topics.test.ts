import { describe, expect, it } from "vitest";
import { hasTopic, toggleTopic } from "./topics";

const TOPIC = "見積アシストのデモ希望";

describe("toggleTopic", () => {
  it("空の欄にはテーマだけを入れる", () => {
    expect(toggleTopic("", TOPIC, true)).toBe(TOPIC);
    expect(toggleTopic("  ", TOPIC, true)).toBe(TOPIC);
  });

  it("書きかけの内容があれば、先頭の行に入れて内容を残す", () => {
    expect(toggleTopic("費用感を知りたい", TOPIC, true)).toBe(`${TOPIC}\n費用感を知りたい`);
  });

  it("同じテーマは二重に入れない", () => {
    const once = toggleTopic("費用感を知りたい", TOPIC, true);
    expect(toggleTopic(once, TOPIC, true)).toBe(once);
  });

  it("外すとテーマの行だけを消し、ほかの内容は残す", () => {
    expect(toggleTopic(`${TOPIC}\n費用感を知りたい`, TOPIC, false)).toBe("費用感を知りたい");
    expect(toggleTopic(TOPIC, TOPIC, false)).toBe("");
    expect(toggleTopic(`別の相談\n${TOPIC}`, TOPIC, false)).toBe("別の相談");
  });

  it("テーマを含むだけの行(文章の一部)は消さない", () => {
    const message = `${TOPIC}について詳しく`;
    expect(hasTopic(message, TOPIC)).toBe(false);
    expect(toggleTopic(message, TOPIC, false)).toBe(message);
  });
});
