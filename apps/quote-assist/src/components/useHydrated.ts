"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** ブラウザで操作できる状態になったか。それまでボタンを無効にして、押しても何も起きない状態を避ける */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
