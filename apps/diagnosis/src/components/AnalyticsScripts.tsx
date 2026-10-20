"use client";

import { Analytics } from "@vercel/analytics/next";
import { useEffect } from "react";
import { ANALYTICS_CONFIG } from "@/lib/analytics";

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

/** 計測のスクリプトを読み込む。NEXT_PUBLIC_ANALYTICS_PROVIDER が未設定なら何もしない */
export function AnalyticsScripts() {
  const config = ANALYTICS_CONFIG;
  const measurementId = config.provider === "ga4" ? config.measurementId : null;

  useEffect(() => {
    if (!measurementId) return;
    const win = window as GtagWindow;
    if (win.gtag) return;
    win.dataLayer = win.dataLayer ?? [];
    // gtag.js は arguments オブジェクトのまま積まれることを前提にしている
    win.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      win.dataLayer!.push(arguments);
    };
    win.gtag("js", new Date());
    win.gtag("config", measurementId);
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.append(script);
  }, [measurementId]);

  return config.provider === "vercel" ? <Analytics /> : null;
}
