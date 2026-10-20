import { afterEach, describe, expect, it, vi } from "vitest";
import { eventParams, resolveAnalyticsConfig, sendEvent, type AnalyticsEvent } from "./analytics";

const { vercelTrack } = vi.hoisted(() => ({ vercelTrack: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track: vercelTrack }));

const EVENTS: AnalyticsEvent[] = [
  { name: "diagnosis_start" },
  { name: "diagnosis_step", step: 2, stepName: "業務にかかる時間" },
  { name: "diagnosis_complete", aiGenerated: true },
  { name: "report_download", reportSource: "standard" },
  { name: "lead_submit" },
];

afterEach(() => {
  vercelTrack.mockReset();
  vi.restoreAllMocks();
});

describe("resolveAnalyticsConfig", () => {
  it.each([
    [undefined, undefined, { provider: null }],
    ["", "G-ABC123", { provider: null }],
    ["vercel", undefined, { provider: "vercel" }],
    [" Vercel ", undefined, { provider: "vercel" }],
    ["debug", undefined, { provider: "debug" }],
    ["ga4", "G-ABC123", { provider: "ga4", measurementId: "G-ABC123" }],
    // 測定IDがない・形式が違うときは計測しない
    ["ga4", undefined, { provider: null }],
    ["ga4", "UA-1234-1", { provider: null }],
    ["matomo", undefined, { provider: null }],
  ])("provider=%s, id=%s", (provider, id, expected) => {
    expect(resolveAnalyticsConfig(provider, id)).toEqual(expected);
  });
});

describe("eventParams", () => {
  it("送るのは決まった値(ステップ番号・名前、AIの有無、レポートの種類)だけ", () => {
    expect(EVENTS.map(eventParams)).toEqual([
      {},
      { step: 2, step_name: "業務にかかる時間" },
      { ai_generated: true },
      { report_source: "standard" },
      {},
    ]);
  });
});

describe("sendEvent", () => {
  it("未設定なら何もしない", () => {
    const win = { gtag: vi.fn() };
    for (const event of EVENTS) sendEvent({ provider: null }, event, win);
    expect(win.gtag).not.toHaveBeenCalled();
    expect(vercelTrack).not.toHaveBeenCalled();
  });

  it("GA4 には gtag の event で送る", () => {
    const win = { gtag: vi.fn() };
    sendEvent({ provider: "ga4", measurementId: "G-ABC123" }, EVENTS[1], win);
    expect(win.gtag).toHaveBeenCalledWith("event", "diagnosis_step", {
      step: 2,
      step_name: "業務にかかる時間",
    });
  });

  it("Vercel Web Analytics にはカスタムイベントで送る(付加情報がなければ省く)", () => {
    sendEvent({ provider: "vercel" }, EVENTS[2], {});
    sendEvent({ provider: "vercel" }, EVENTS[0], {});
    expect(vercelTrack.mock.calls).toEqual([
      ["diagnosis_complete", { ai_generated: true }],
      ["diagnosis_start", undefined],
    ]);
  });

  it("debug はページの変数とコンソールに出す(E2Eと手元の確認用)", () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
    const win: Parameters<typeof sendEvent>[2] = {};
    sendEvent({ provider: "debug" }, EVENTS[3], win);
    expect(win?.__analyticsEvents).toEqual([
      { name: "report_download", params: { report_source: "standard" } },
    ]);
    expect(consoleInfo).toHaveBeenCalledWith("[analytics]", "report_download", {
      report_source: "standard",
    });
  });

  it("送信で例外が起きても、画面の操作は止めない", () => {
    const win = {
      gtag: () => {
        throw new Error("blocked");
      },
    };
    expect(() =>
      sendEvent({ provider: "ga4", measurementId: "G-ABC123" }, EVENTS[4], win),
    ).not.toThrow();
  });

  it("ブラウザでなければ(サーバーでの描画中)何もしない", () => {
    sendEvent({ provider: "vercel" }, EVENTS[0], undefined);
    expect(vercelTrack).not.toHaveBeenCalled();
  });
});
