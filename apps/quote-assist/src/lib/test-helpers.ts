import fs from "node:fs";
import path from "node:path";
import { createAiQuota } from "./ai/quota";
import { loadReferenceData } from "./reference/load";
import { createMockSalesforce } from "./crm/mock";
import type { Deps } from "./deps";
import { createMemoryStorage } from "./storage/memory-store";

// テスト用の部品。参照データは合成データ(data/)をそのまま使う

export const DATA_DIR = path.join(process.cwd(), "data");
export const SAMPLES_DIR = path.join(process.cwd(), "public", "samples");

export function sampleFile(name: string) {
  return { name, data: new Uint8Array(fs.readFileSync(path.join(SAMPLES_DIR, name))) };
}

export function testDeps(overrides: Partial<Deps> = {}): Deps {
  const storage = createMemoryStorage();
  return {
    storage,
    reference: () => loadReferenceData(DATA_DIR),
    aiMode: "demo",
    aiQuota: createAiQuota(1000),
    crm: createMockSalesforce(storage.mockCrm),
    now: () => new Date("2026-10-19T01:00:00Z"),
    ...overrides,
  };
}

/** 受付日(日本時間) */
export const TEST_TODAY = "2026-10-19";
