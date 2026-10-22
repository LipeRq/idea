import { BaselineInputSchema } from "@/lib/domain/impact";
import { handle, readJson } from "@/lib/http";
import { loadBaseline, saveBaseline } from "@/lib/impact/load";

/** ベースライン(導入前の記録シート)を読む。保存済みがなければデモ用の架空データか空 */
export async function GET() {
  return handle("impact.baseline.get", async (deps) => {
    const { baseline, source } = await loadBaseline(deps);
    return Response.json({ baseline, source });
  });
}

/** ベースラインを保存する(全行の置き換え。取り込みもこれで保存する) */
export async function PUT(request: Request) {
  return handle("impact.baseline.put", async (deps) => {
    // 1000行・512KBまでのCSVを取り込めるよう、本文は1MBまで
    const body = BaselineInputSchema.parse(await readJson(request, 1024 * 1024));
    const baseline = await saveBaseline(deps, body);
    return Response.json({ baseline });
  });
}

/** 保存したベースラインを消す(デモ用データがあればそちらに戻る) */
export async function DELETE() {
  return handle("impact.baseline.delete", async (deps) => {
    await deps.storage.impact.deleteBaseline();
    return Response.json({ ok: true });
  });
}
