import { afterEach, describe, expect, it, vi } from "vitest";
import { createDailyCounter, DAILY_KEY_TTL_MS, jstDay } from "./daily-counter";

const config = { url: "https://example.upstash.io", token: "token", keyPrefix: "ai-app:" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("jstDay", () => {
  it("日本時間で日付を区切る", () => {
    expect(jstDay(new Date("2026-10-18T14:59:59Z"))).toBe("2026-10-18");
    expect(jstDay(new Date("2026-10-18T15:00:00Z"))).toBe("2026-10-19");
  });
});

describe("createDailyCounter(メモリ)", () => {
  it("名前ごとに足していき、日付が変わるとすべて数え直す", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const counter = createDailyCounter();
    expect(await counter.add(null, "count", "2026-10-18")).toBe(1);
    expect(await counter.add(null, "count", "2026-10-18")).toBe(2);
    expect(await counter.add(null, "tokens", "2026-10-18", 1500)).toBe(1500);
    expect(await counter.add(null, "tokens", "2026-10-18", 500)).toBe(2000);
    expect(await counter.add(null, "count", "2026-10-19")).toBe(1);
    expect(await counter.add(null, "tokens", "2026-10-19", 10)).toBe(10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("カウンターごとに別々に数え、reset で消える", async () => {
    const a = createDailyCounter();
    const b = createDailyCounter();
    await a.add(null, "count", "2026-10-18");
    expect(await b.add(null, "count", "2026-10-18")).toBe(1);
    a.reset();
    expect(await a.add(null, "count", "2026-10-18")).toBe(1);
  });
});

describe("createDailyCounter(Upstash)", () => {
  it("<名前>:<日付> のキーで数え、2日で消えるようにする。量を省くと INCR、指定すると INCRBY", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify([{ result: "OK" }, { result: 7 }])));
    const counter = createDailyCounter();

    expect(await counter.add(config, "ai-daily", "2026-10-19")).toBe(7);
    await counter.add(config, "ai-daily:tokens", "2026-10-19", 1200);
    const [first, second] = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)) as string[][]);
    expect(first).toEqual([
      ["SET", "ai-app:ai-daily:2026-10-19", "0", "PX", String(DAILY_KEY_TTL_MS), "NX"],
      ["INCR", "ai-app:ai-daily:2026-10-19"],
    ]);
    expect(second[1]).toEqual(["INCRBY", "ai-app:ai-daily:tokens:2026-10-19", "1200"]);
    expect(DAILY_KEY_TTL_MS).toBe(2 * 24 * 60 * 60 * 1000);
  });

  it("接続できなければ例外のまま投げる(扱いはアプリが決める)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(createDailyCounter().add(config, "ai-daily", "2026-10-19")).rejects.toThrow("fetch failed");
  });
});
