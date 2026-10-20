import { describe, expect, it } from "vitest";
import { DATA_DIR } from "../test-helpers";
import { checkReferences, loadReferenceData } from "./load";

describe("参照データの検査", () => {
  it("合成データは検査を通る", async () => {
    await expect(loadReferenceData(DATA_DIR)).resolves.toBeTruthy();
  });

  it.each([
    ["材料", (d: Awaited<ReturnType<typeof loadReferenceData>>) => d.rates.materials.push({ ...d.rates.materials[0], pricePerKg: 1 })],
    ["工程", (d: Awaited<ReturnType<typeof loadReferenceData>>) => d.rates.processes.push({ ...d.rates.processes[0] })],
    ["表面処理・熱処理", (d: Awaited<ReturnType<typeof loadReferenceData>>) => d.rates.treatments.push({ ...d.rates.treatments[0] })],
    ["数量係数の下限数量", (d: Awaited<ReturnType<typeof loadReferenceData>>) => d.rates.rules.quantityBreaks.push({ minQty: 10, factor: 0.5 })],
  ])("単価表の%sのidが重複していたら読み込まない(先頭の行だけが計算に使われ、画面の単価表と食い違うため)", async (label, mutate) => {
    const data = structuredClone(await loadReferenceData(DATA_DIR));
    mutate(data);
    expect(() => checkReferences(data)).toThrow(`単価表(${label})`);
  });

  it("過去案件が単価表にない材質を参照していたら読み込まない", async () => {
    const data = structuredClone(await loadReferenceData(DATA_DIR));
    data.rates.materials = data.rates.materials.filter((m) => m.id !== data.cases[0].materialId);
    expect(() => checkReferences(data)).toThrow("単価表にない材質");
  });
});
