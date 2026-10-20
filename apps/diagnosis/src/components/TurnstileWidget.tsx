"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { TurnstileAction } from "@/lib/turnstile";

// Cloudflare Turnstile(ボット対策)のウィジェット。NEXT_PUBLIC_TURNSTILE_SITE_KEY がなければ何も表示しない。
// トークンは1回しか使えず、約5分で切れる(切れると自動で取り直す)。送信に失敗したら reset() で取り直す。

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || undefined;

/** 送信時にトークンがまだないときの案内 */
export const TURNSTILE_PENDING_MESSAGE =
  "セキュリティ確認が終わっていません。確認が完了してから、もう一度お試しください。";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  const win = window as TurnstileWindow;
  if (win.turnstile) return Promise.resolve(win.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      win.turnstile ? resolve(win.turnstile) : reject(new Error("Turnstile を読み込めませんでした"));
    script.onerror = () => {
      // 次に表示したときに読み込み直せるようにする
      scriptPromise = null;
      script.remove();
      reject(new Error("Turnstile を読み込めませんでした"));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

export type TurnstileHandle = { reset(): void };

type Props = {
  action: TurnstileAction;
  onTokenChange: (token: string | null) => void;
  ref?: Ref<TurnstileHandle>;
};

export function TurnstileWidget({ action, onTokenChange, ref }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const emitToken = useEffectEvent((token: string | null) => onTokenChange(token));

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenChange(null);
      const win = window as TurnstileWindow;
      if (widgetId.current) win.turnstile?.reset(widgetId.current);
    },
  }));

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        const container = containerRef.current;
        if (cancelled || !container) return;
        widgetId.current = api.render(container, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          language: "ja",
          theme: "auto",
          // 幅が300px未満の枠(スマホの申し込みフォーム)では縦長の小さい表示にする
          size: container.clientWidth < 300 ? "compact" : "flexible",
          callback: (token: string) => {
            setFailed(false);
            emitToken(token);
          },
          "expired-callback": () => emitToken(null),
          "error-callback": () => {
            setFailed(true);
            emitToken(null);
          },
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      const win = window as TurnstileWindow;
      if (widgetId.current) win.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [action]);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <div className="space-y-1">
      <div ref={containerRef} />
      {failed && (
        <p className="text-sm font-medium text-critical">
          セキュリティ確認を表示できませんでした。通信環境をご確認のうえ、ページを読み込み直してください。
        </p>
      )}
    </div>
  );
}
