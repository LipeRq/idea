import { track as vercelTrack } from "@vercel/analytics";

// 診断のファネルを計測するイベント。送り先は NEXT_PUBLIC_ANALYTICS_PROVIDER で選び、未設定なら何もしない。
// 個人情報(会社名・氏名・連絡先・相談内容・入力した数値)は送らない。送るのは下の型にある値だけ。

export type AnalyticsProvider = "vercel" | "ga4" | "debug";

export type AnalyticsConfig =
  | { provider: null }
  | { provider: "vercel" | "debug" }
  | { provider: "ga4"; measurementId: string };

export type AnalyticsEvent =
  /** フォームに最初に入力した(ページを開くたびに1回) */
  | { name: "diagnosis_start" }
  /** ステップに初めて進んだ(2・3。1はページを開いた時点で到達している) */
  | { name: "diagnosis_step"; step: number; stepName: string }
  /** 結果が表示された */
  | { name: "diagnosis_complete"; aiGenerated: boolean }
  /** PDFをダウンロードした */
  | { name: "report_download"; reportSource: "ai" | "standard" }
  /** 無料相談の申し込みが完了した */
  | { name: "lead_submit" };

export type EventParams = Record<string, string | number | boolean>;

type AnalyticsWindow = {
  gtag?: (...args: unknown[]) => void;
  __analyticsEvents?: { name: string; params: EventParams }[];
};

/** 環境変数の値から計測の設定を作る。値に誤りがあれば計測しない */
export function resolveAnalyticsConfig(
  provider: string | undefined,
  gaMeasurementId: string | undefined,
): AnalyticsConfig {
  switch (provider?.trim().toLowerCase()) {
    case "vercel":
      return { provider: "vercel" };
    case "debug":
      return { provider: "debug" };
    case "ga4": {
      const id = gaMeasurementId?.trim();
      return id && /^G-[A-Z0-9]+$/.test(id) ? { provider: "ga4", measurementId: id } : { provider: null };
    }
    default:
      return { provider: null };
  }
}

// NEXT_PUBLIC_ の値はビルド時に埋め込まれる(process.env.〜 と直接書いたときだけ)
export const ANALYTICS_CONFIG = resolveAnalyticsConfig(
  process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER,
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
);

/** イベントの付加情報(GA4 の推奨に合わせて snake_case) */
export function eventParams(event: AnalyticsEvent): EventParams {
  switch (event.name) {
    case "diagnosis_step":
      return { step: event.step, step_name: event.stepName };
    case "diagnosis_complete":
      return { ai_generated: event.aiGenerated };
    case "report_download":
      return { report_source: event.reportSource };
    default:
      return {};
  }
}

export function sendEvent(
  config: AnalyticsConfig,
  event: AnalyticsEvent,
  win: AnalyticsWindow | undefined = typeof window === "undefined" ? undefined : (window as AnalyticsWindow),
): void {
  if (!config.provider || !win) return;
  const params = eventParams(event);
  // 計測の失敗で画面の操作を止めない
  try {
    if (config.provider === "vercel") {
      vercelTrack(event.name, Object.keys(params).length > 0 ? params : undefined);
    } else if (config.provider === "ga4") {
      win.gtag?.("event", event.name, params);
    } else {
      (win.__analyticsEvents ??= []).push({ name: event.name, params });
      console.info("[analytics]", event.name, params);
    }
  } catch {
    // 何もしない
  }
}

/** 画面から呼ぶ。計測が無効なら何もしない */
export function track(event: AnalyticsEvent): void {
  sendEvent(ANALYTICS_CONFIG, event);
}
