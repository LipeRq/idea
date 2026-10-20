import { connection } from "next/server";
import { Suspense } from "react";
import { Card, Loading } from "@/components/ui";
import { MATERIAL_GROUP_LABEL } from "@/lib/domain/reference";
import { getDeps } from "@/lib/deps";
import { formatDate, formatRate, formatYen } from "@/lib/format";

export default function RatesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}

const th = "py-2 pr-3 text-left font-medium";
const td = "py-2 pr-3";

async function Content() {
  await connection();
  const ref = await getDeps().reference();
  const { rates, company } = ref;
  const r = rates.rules;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">単価表</h1>
        <p className="text-ink-2">
          {rates.name}(更新日 {formatDate(rates.updatedAt)})。見積金額はこの表と工数からプログラムで計算します。表(data/rate-table.json)を差し替えると計算が変わります。
        </p>
      </div>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">工程別チャージ</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-ink-2">
              <tr className="border-b border-line">
                <th className={th}>工程</th>
                <th className={`${th} text-right`}>チャージ(円/h)</th>
                <th className={`${th} text-right`}>段取りチャージ(円/h)</th>
                <th className={th}>備考</th>
              </tr>
            </thead>
            <tbody>
              {rates.processes.map((p) => (
                <tr key={p.id} id={`process-${p.id}`} className="scroll-mt-20 border-b border-line last:border-0 target:bg-accent-soft">
                  <th scope="row" className={th}>
                    {p.name}
                  </th>
                  <td className={`${td} text-right tabular-nums`}>{p.chargePerHour.toLocaleString("ja-JP")}</td>
                  <td className={`${td} text-right tabular-nums`}>{p.setupChargePerHour.toLocaleString("ja-JP")}</td>
                  <td className={`${td} text-ink-2`}>{p.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">材料単価</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-ink-2">
              <tr className="border-b border-line">
                <th className={th}>材質</th>
                <th className={th}>系統</th>
                <th className={`${th} text-right`}>単価(円/kg)</th>
                <th className={`${th} text-right`}>比重</th>
                <th className={`${th} text-right`}>最低材料費</th>
                <th className={th}>別名</th>
              </tr>
            </thead>
            <tbody>
              {rates.materials.map((m) => (
                <tr key={m.id} id={`material-${m.id}`} className="scroll-mt-20 border-b border-line last:border-0 target:bg-accent-soft">
                  <th scope="row" className={th}>
                    {m.name}
                  </th>
                  <td className={td}>{MATERIAL_GROUP_LABEL[m.group]}</td>
                  <td className={`${td} text-right tabular-nums`}>{m.pricePerKg.toLocaleString("ja-JP")}</td>
                  <td className={`${td} text-right tabular-nums`}>{m.densityGPerCm3}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatYen(m.minChargePerLot)}</td>
                  <td className={`${td} text-ink-2`}>{m.aliases.join("、")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">外注(表面処理・熱処理)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-ink-2">
              <tr className="border-b border-line">
                <th className={th}>処理</th>
                <th className={th}>種類</th>
                <th className={`${th} text-right`}>単価</th>
                <th className={`${th} text-right`}>最低ロット料金</th>
                <th className={`${th} text-right`}>標準日数</th>
                <th className={th}>対象材質</th>
              </tr>
            </thead>
            <tbody>
              {rates.treatments.map((t) => (
                <tr key={t.id} id={`treatment-${t.id}`} className="scroll-mt-20 border-b border-line last:border-0 target:bg-accent-soft">
                  <th scope="row" className={th}>
                    {t.name}
                  </th>
                  <td className={td}>{t.kind === "heat" ? "熱処理" : "表面処理"}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {formatYen(t.unitPrice)}/{t.pricing === "per_kg" ? "kg" : "個"}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>{formatYen(t.minLotCharge)}</td>
                  <td className={`${td} text-right tabular-nums`}>{t.leadDays}日</td>
                  <td className={td}>{t.materialGroups.map((g) => MATERIAL_GROUP_LABEL[g]).join("・")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 id="rules" className="scroll-mt-20 text-lg font-bold">
          見積ルール
        </h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="font-semibold">管理費率</dt>
          <dd>直接原価の{formatRate(r.overheadRate)}</dd>
          <dt className="font-semibold">利益率(初期値)</dt>
          <dd>(直接原価+管理費)の{formatRate(r.defaultProfitRate)}。見積ごとに人が変更できます(AIは変更しません)</dd>
          <dt className="font-semibold">数量による量産効果</dt>
          <dd>{r.quantityBreaks.map((b) => `${b.minQty}個以上 ×${b.factor}`).join(" / ")}(1個あたり加工時間に掛ける)</dd>
          <dt className="font-semibold">取り代</dt>
          <dd>
            角物 長さ+{r.blankAllowanceMm.block.lengthMm}・幅+{r.blankAllowanceMm.block.widthMm}・厚さ+{r.blankAllowanceMm.block.heightMm}mm、丸物 直径+
            {r.blankAllowanceMm.round.diameterMm}・長さ+{r.blankAllowanceMm.round.lengthMm}mm、板物 長さ・幅+{r.blankAllowanceMm.sheet.lengthMm}mm
          </dd>
          <dt className="font-semibold">標準リードタイム</dt>
          <dd>
            {r.leadTime.baseDays}営業日+50個ごとに{r.leadTime.extraDaysPer50Pieces}日+外注の標準日数
          </dd>
          <dt className="font-semibold">特急料金</dt>
          <dd>希望納期が標準リードタイムより短いとき、(加工費+段取り費)×{formatRate(r.expedite.surchargeRate)}</dd>
          <dt className="font-semibold">端数処理</dt>
          <dd>単価を{r.rounding.unitStepYen}円単位に切り上げ</dd>
          <dt className="font-semibold">警告</dt>
          <dd>
            類似案件の単価から{formatRate(r.priceDeviationWarnRate)}以上離れたとき、単価表の更新から{r.staleAfterDays}日を過ぎたとき
          </dd>
        </dl>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-bold">設備({company.name})</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {company.equipment.map((e) => (
            <li key={e.id} className="rounded-md bg-surface-2 px-3 py-2">
              <span className="font-medium">{e.name}</span> ×{e.count}
              <span className="block text-xs text-ink-2">
                {e.maxDiameterMm ? `最大 φ${e.maxDiameterMm} × ${e.maxLengthMm}mm` : `最大 ${e.maxLengthMm} × ${e.maxWidthMm} × ${e.maxHeightMm}mm`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
