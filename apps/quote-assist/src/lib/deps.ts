import path from "node:path";
import { hasAnthropicCredentials } from "./ai/client";
import { createCrmConnector } from "./crm";
import type { CrmConnector } from "./crm/types";
import { loadReferenceData, type ReferenceData } from "./reference/load";
import { createFileStorage } from "./storage/file-store";
import { createMemoryStorage } from "./storage/memory-store";
import type { Storage } from "./storage/types";

// 環境変数から、保存先・参照データ・AI・CRMの実装を選ぶ。
// SaaS(共用)でも専用環境でも、差し替えはこのファイルと環境変数だけで行う。

type Env = Record<string, string | undefined>;

export type Deps = {
  storage: Storage;
  reference: () => Promise<ReferenceData>;
  /** AIの処理場所。"anthropic" は Claude API、"demo" は合成データ用の固定結果 */
  aiMode: "anthropic" | "demo";
  crm: CrmConnector;
  now: () => Date;
};

export function dataDir(env: Env = process.env): string {
  const root = env.QUOTE_ASSIST_DATA_DIR || path.join(process.cwd(), ".data");
  const tenant = env.TENANT_ID?.trim();
  if (tenant && !/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) throw new Error("TENANT_ID に使えない文字があります");
  return tenant ? path.join(root, "tenants", tenant) : root;
}

export function aiModeFromEnv(env: Env = process.env): Deps["aiMode"] {
  if (env.AI_PROVIDER === "demo") return "demo";
  return hasAnthropicCredentials() ? "anthropic" : "demo";
}

let storage: Storage | null = null;
let storageKey = "";

function getStorage(): Storage {
  const key = `${process.env.STORAGE_DRIVER ?? "file"}:${dataDir()}`;
  if (!storage || storageKey !== key) {
    storage = process.env.STORAGE_DRIVER === "memory" ? createMemoryStorage() : createFileStorage(dataDir());
    storageKey = key;
  }
  return storage;
}

export function getDeps(): Deps {
  const s = getStorage();
  return {
    storage: s,
    reference: () => loadReferenceData(),
    aiMode: aiModeFromEnv(),
    crm: createCrmConnector(s.mockCrm),
    now: () => new Date(),
  };
}
