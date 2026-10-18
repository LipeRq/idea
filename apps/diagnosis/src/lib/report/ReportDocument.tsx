import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { READINESS_LEVEL_LABEL, type DiagnosisResult, type TaskResult } from "../diagnosis/calculate";
import { COST_BY_DIFFICULTY, DIFFICULTY_LABEL } from "../diagnosis/master";
import type { AiReport, DiagnosisInput } from "../diagnosis/schema";
import { formatHours, formatYen } from "../format";

export const PDF_FONT_FAMILY = "NotoSansJP";

export type ReportDocumentProps = {
  input: DiagnosisInput;
  result: DiagnosisResult;
  report: AiReport;
  aiGenerated: boolean;
  issuedAt: Date;
  brandName: string;
  contactUrl?: string;
};

// globals.css のライトモードの色に合わせる(PDFは常に白い紙に出す)
const C = {
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#6b6964",
  line: "#e4e3df",
  surface2: "#f3f2ee",
  accent: "#2a78d6",
  accentStrong: "#1c5cab",
  accentSoft: "#e6effb",
  track: "#cde2fb",
};

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontFamily: PDF_FONT_FAMILY,
    fontSize: 9.5,
    lineHeight: 1.6,
    color: C.ink,
  },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, height: 5, backgroundColor: C.accent },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: C.muted,
    borderTopWidth: 0.5,
    borderTopColor: C.line,
    paddingTop: 6,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  brand: { fontSize: 9, fontWeight: 700, color: C.accentStrong },
  muted: { color: C.muted },
  ink2: { color: C.ink2 },
  small: { fontSize: 8 },
  bold: { fontWeight: 700 },
  title: { marginTop: 14, fontSize: 19, fontWeight: 700, lineHeight: 1.35 },
  lead: { marginTop: 4, fontSize: 8.5, color: C.muted },
  profile: { marginTop: 8, fontSize: 8.5, color: C.ink2 },
  hero: {
    marginTop: 14,
    padding: 14,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.line,
  },
  heroLabel: { fontSize: 9, color: C.ink2 },
  heroValue: { fontSize: 30, fontWeight: 700, lineHeight: 1.2, marginTop: 2, marginBottom: 4 },
  tiles: { flexDirection: "row", marginTop: 10, marginHorizontal: -4 },
  tile: {
    flex: 1,
    marginHorizontal: 4,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.line,
  },
  tileValue: { fontSize: 14, fontWeight: 700, marginTop: 2, lineHeight: 1.3 },
  section: { marginTop: 18 },
  h2: {
    fontSize: 12.5,
    fontWeight: 700,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  card: {
    marginTop: 8,
    padding: 11,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.line,
  },
  rank: { fontSize: 8.5, fontWeight: 700, color: C.accentStrong },
  // lineHeight を変えるときは fontSize も同じスタイルに書く(書かないと行間が広がる)
  goal: { fontSize: 9.5, fontWeight: 700, lineHeight: 1.45, marginBottom: 2 },
  cardTitle: { fontSize: 11.5, fontWeight: 700, lineHeight: 1.4 },
  metrics: {
    flexDirection: "row",
    marginTop: 6,
    marginBottom: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: C.surface2,
  },
  metric: { flex: 1 },
  metricValue: { fontWeight: 700 },
  chips: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  chip: {
    fontSize: 8,
    color: C.ink2,
    borderWidth: 0.75,
    borderColor: C.line,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginRight: 4,
    marginTop: 3,
  },
  twoCol: { flexDirection: "row", marginHorizontal: -5 },
  col: { flex: 1, marginHorizontal: 5 },
  label: { fontWeight: 700, fontSize: 8.5 },
  bulletRow: { flexDirection: "row", marginTop: 2 },
  bullet: { width: 10, color: C.accent },
  bulletText: { flex: 1 },
  // グラフ
  chartRow: { flexDirection: "row", alignItems: "center", height: 16 },
  chartLabel: { width: 150, fontSize: 8, color: C.ink2, flexDirection: "row", alignItems: "center" },
  badge: {
    fontSize: 6.5,
    fontWeight: 700,
    color: C.ink,
    backgroundColor: C.accentSoft,
    borderRadius: 2,
    paddingHorizontal: 3,
    marginRight: 3,
  },
  barArea: { flex: 1, flexDirection: "row", alignItems: "center" },
  // 4px相当の角丸は値の側だけ。基準線の側は角を立てる
  bar: {
    height: 9,
    backgroundColor: C.accent,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  barValue: { marginLeft: 4, fontSize: 8, fontWeight: 700 },
  // 表
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line },
  th: { backgroundColor: C.surface2, color: C.ink2, fontSize: 8 },
  td: { paddingVertical: 3, paddingHorizontal: 4, fontSize: 8 },
  num: { textAlign: "right" },
  meterTrack: { height: 4, borderRadius: 2, backgroundColor: C.track, marginTop: 2 },
  meterFill: { height: 4, borderRadius: 2, backgroundColor: C.accent },
  cta: {
    marginTop: 18,
    padding: 14,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.accent,
    backgroundColor: C.accentSoft,
  },
  link: { color: C.accentStrong, textDecoration: "underline" },
});

const COLUMN_WIDTHS = ["34%", "13%", "11%", "13%", "17%", "12%"] as const;

function formatIssuedDate(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function payback(t: TaskResult): string {
  return t.paybackMonths === null ? "回収困難" : `約${t.paybackMonths}ヶ月`;
}

export function ReportDocument({
  input,
  result,
  report,
  aiGenerated,
  issuedAt,
  brandName,
  contactUrl,
}: ReportDocumentProps) {
  const { readiness, totals } = result;
  const topIds = new Set(result.top.map((t) => t.taskId));
  const recommendationByTask = new Map(report.recommendations.map((r) => [r.taskId, r]));
  const title = `${input.companyName ? `${input.companyName}様の` : ""}AI導入診断レポート`;

  return (
    <Document
      title={title}
      author={brandName}
      subject="AI導入診断の結果"
      creator={brandName}
      producer={brandName}
      language="ja"
    >
      <Page size="A4" style={s.page}>
        <View style={s.topBar} fixed />
        <View style={s.footer} fixed>
          <Text>{brandName} | 試算は概算であり、効果を保証するものではありません</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>

        <View style={s.headerRow}>
          <Text style={s.brand}>{brandName}</Text>
          <Text style={[s.small, s.muted]}>発行日 {formatIssuedDate(issuedAt)}</Text>
        </View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.lead}>
          {aiGenerated
            ? "回答内容をもとにAIが個別に分析したレポートです。数値はすべて決まった計算式で算出しています。"
            : "標準レポートです(AIによる個別分析は行っていません)。数値は決まった計算式で算出しています。"}
        </Text>
        <Text style={s.profile}>
          業種:{input.industry} / 従業員規模:{input.employees} / 優先したいこと:
          {input.goals.length > 0 ? input.goals.join("、") : "未回答"}
        </Text>

        <View style={s.hero}>
          <Text style={s.heroLabel}>年間の削減見込み額</Text>
          <Text style={s.heroValue}>{formatYen(totals.annualSavedAmount)}</Text>
          <Text style={s.ink2}>
            年間 約{formatHours(totals.annualSavedHours)}の業務をAIで削減できる見込みです(入力された業務 月
            {formatHours(totals.monthlyHours)}のうち)
          </Text>
        </View>
        <View style={s.tiles}>
          <Tile
            label="AI導入の準備度"
            value={`${readiness.score}点`}
            note={READINESS_LEVEL_LABEL[readiness.level]}
          />
          <Tile
            label="優先施策の初期費用(目安)"
            value={formatYen(totals.topInitialCost)}
            note={`上位${result.top.length}施策の合計`}
          />
          <Tile
            label="優先施策の年間運用費(目安)"
            value={formatYen(totals.topAnnualRunningCost)}
            note={`削減見込み 年${formatYen(totals.topAnnualSavedAmount)}`}
          />
        </View>

        <Section title="総評">
          <Text style={s.ink2}>{report.summary}</Text>
        </Section>

        <Section title="業務別の年間削減見込み額">
          <SavingsBars tasks={result.tasks} topIds={topIds} />
          <Text style={[s.small, s.muted, { marginTop: 4 }]}>
            「優先」は優先度(削減額 ÷ 難易度)の上位{result.top.length}業務です。
          </Text>
        </Section>

        <Section title="優先して取り組む施策" breakBefore>
          {result.top.map((t, i) => {
            const rec = recommendationByTask.get(t.taskId);
            if (!rec) return null;
            return (
              <View key={t.taskId} style={s.card} wrap={false}>
                <Text style={s.rank}>
                  優先度 {i + 1} <Text style={[s.muted, { fontWeight: 400 }]}>{t.name}</Text>
                </Text>
                <Text style={s.cardTitle}>{rec.title}</Text>
                <View style={s.metrics}>
                  <Metric label="月の削減時間" value={formatHours(t.monthlySavedHours)} />
                  <Metric label="年間削減額" value={formatYen(t.annualSavedAmount)} />
                  <Metric label="難易度" value={DIFFICULTY_LABEL[t.difficulty]} />
                  <Metric label="投資回収" value={payback(t)} />
                </View>
                <Text style={s.ink2}>{rec.approach}</Text>
                <View style={s.chips}>
                  {rec.tools.map((tool, j) => (
                    <Text key={j} style={s.chip}>
                      {tool}
                    </Text>
                  ))}
                </View>
                <View style={[s.twoCol, { marginTop: 6 }]}>
                  <View style={s.col}>
                    <Text style={s.label}>最初の一歩</Text>
                    <Text style={s.ink2}>{rec.firstStep}</Text>
                  </View>
                  <View style={s.col}>
                    <Text style={s.label}>注意点</Text>
                    <Text style={s.ink2}>{rec.caution}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </Section>

        <Section title="3ヶ月のロードマップ">
          <View style={s.twoCol} wrap={false}>
            {report.roadmap.map((phase, i) => (
              <View key={i} style={[s.col, s.card, { marginTop: 0 }]}>
                <Text style={s.rank}>{phase.period}</Text>
                <Text style={s.goal}>{phase.goal}</Text>
                <Bullets items={phase.actions} styles={[s.ink2, s.small]} />
              </View>
            ))}
          </View>
        </Section>

        <View style={[s.section, s.twoCol]} wrap={false}>
          <View style={s.col}>
            <Text style={s.h2}>
              準備度の内訳({readiness.score}点 / 100点)
            </Text>
            {readiness.breakdown.map((b) => (
              <View key={b.id} style={{ marginBottom: 5 }}>
                <View style={s.headerRow}>
                  <Text style={[s.small, s.bold]}>{b.label}</Text>
                  <Text style={[s.small, s.ink2]}>
                    {Math.round(b.weightedScore)} / {b.weight}
                  </Text>
                </View>
                <View style={s.meterTrack}>
                  <View style={[s.meterFill, { width: `${(b.points / 3) * 100}%` }]} />
                </View>
                <Text style={[s.small, s.muted]}>{b.answer}</Text>
              </View>
            ))}
          </View>
          <View style={s.col}>
            <Text style={s.h2}>導入前に整えたいこと</Text>
            <Bullets items={report.readinessAdvice} styles={[s.ink2]} />
          </View>
        </View>

        <Section title="試算の内訳と前提">
          <View>
            <View style={[s.tr, s.th]} wrap={false}>
              {["業務", "現在(月)", "削減率", "削減(月)", "削減額(年)", "難易度"].map((h, i) => (
                <Text
                  key={h}
                  style={[s.td, { width: COLUMN_WIDTHS[i] }, i > 0 && i < 5 ? s.num : {}]}
                >
                  {h}
                </Text>
              ))}
            </View>
            {result.tasks.map((t) => (
              <View key={t.taskId} style={s.tr} wrap={false}>
                <Text style={[s.td, { width: COLUMN_WIDTHS[0] }]}>
                  {t.name}
                  {t.prerequisiteGap ? (
                    <Text style={[s.muted, { fontSize: 7 }]}> ※前提条件の整備が必要</Text>
                  ) : null}
                </Text>
                <Text style={[s.td, s.num, { width: COLUMN_WIDTHS[1] }]}>
                  {formatHours(t.monthlyHours)}
                </Text>
                <Text style={[s.td, s.num, { width: COLUMN_WIDTHS[2] }]}>
                  {Math.round(t.automationRate * 100)}%
                </Text>
                <Text style={[s.td, s.num, { width: COLUMN_WIDTHS[3] }]}>
                  {formatHours(t.monthlySavedHours)}
                </Text>
                <Text style={[s.td, s.num, { width: COLUMN_WIDTHS[4] }]}>
                  {formatYen(t.annualSavedAmount)}
                </Text>
                <Text style={[s.td, { width: COLUMN_WIDTHS[5] }]}>
                  {DIFFICULTY_LABEL[t.difficulty]}
                </Text>
              </View>
            ))}
          </View>
          <View style={{ marginTop: 8 }} wrap={false}>
            <Text style={s.label}>試算の前提</Text>
            <Bullets
              styles={[s.ink2, s.small]}
              items={[
                `削減時間 = 現在の工数 × 業務ごとの削減率 × 実現係数(${result.realizationFactor}。準備度に応じて0.5〜1.0)`,
                `削減額 = 削減時間 × 平均人件費(1時間あたり${input.hourlyCost.toLocaleString("ja-JP")}円)`,
                `費用は難易度ごとの目安です(低:初期${formatYen(COST_BY_DIFFICULTY[1].initial)}・月${formatYen(COST_BY_DIFFICULTY[1].monthly)}、中:初期${formatYen(COST_BY_DIFFICULTY[2].initial)}・月${formatYen(COST_BY_DIFFICULTY[2].monthly)}、高:初期${formatYen(COST_BY_DIFFICULTY[3].initial)}・月${formatYen(COST_BY_DIFFICULTY[3].monthly)})`,
                "投資回収の月数 = 初期費用 ÷(月の削減額 − 月額費用)。月の削減額が月額費用を下回る場合は「回収困難」",
                "業務データが整っていない場合などは、前提条件の不足として難易度を1段上げています",
              ]}
            />
            <Text style={[s.label, { marginTop: 6 }]}>ご注意</Text>
            <Bullets
              styles={[s.ink2, s.small]}
              items={[
                "試算は入力内容と一般的な目安にもとづく概算で、効果を保証するものではありません。",
                "実際の効果や費用は、業務の内容、使うツール、社内の体制によって変わります。",
                ...(aiGenerated
                  ? [
                      "総評・施策・ロードマップなどの文章はAIが作成しています。導入の判断の前に、専門家と内容をご確認ください。",
                    ]
                  : []),
              ]}
            />
          </View>
        </Section>

        <View style={s.cta} wrap={false}>
          <Text style={[s.h2, { borderBottomColor: C.track }]}>専門家と一緒に深掘りしたいポイント</Text>
          <Bullets items={report.discussionPoints} styles={[s.ink2]} />
          <Text style={{ marginTop: 8 }}>
            無料相談では、この診断結果をもとに、優先業務の進め方やツール選定、効果の測り方を具体化します。
          </Text>
          {contactUrl ? (
            <Text style={{ marginTop: 2 }}>
              お申し込み:<Link src={contactUrl} style={s.link}>{contactUrl}</Link>
            </Text>
          ) : (
            <Text style={{ marginTop: 2 }}>お申し込みは、診断結果画面のフォームから受け付けています。</Text>
          )}
        </View>
      </Page>
    </Document>
  );
}

function Section({
  title,
  breakBefore = false,
  children,
}: {
  title: string;
  breakBefore?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={s.section} break={breakBefore}>
      {/* 見出しだけがページの最後に残らないようにする */}
      <Text style={s.h2} minPresenceAhead={60}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <View style={s.tile}>
      <Text style={[s.small, s.ink2]}>{label}</Text>
      <Text style={s.tileValue}>{value}</Text>
      <Text style={[s.small, s.muted]}>{note}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metric}>
      <Text style={[s.small, s.muted]}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
    </View>
  );
}

type PdfStyle = (typeof s)[keyof typeof s];

function Bullets({ items, styles = [] }: { items: string[]; styles?: PdfStyle[] }) {
  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={s.bulletRow}>
          <Text style={[s.bullet, ...styles]}>・</Text>
          <Text style={[s.bulletText, ...styles]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

// 単一系列の横棒グラフ。値は棒の先に文字色で書き、凡例は置かない(見出しが内容を示す)
function SavingsBars({ tasks, topIds }: { tasks: TaskResult[]; topIds: Set<string> }) {
  const max = Math.max(...tasks.map((t) => t.annualSavedAmount), 1);
  const sorted = [...tasks].sort((a, b) => b.annualSavedAmount - a.annualSavedAmount);
  return (
    <View wrap={false}>
      {sorted.map((t) => (
        <View key={t.taskId} style={s.chartRow}>
          <View style={s.chartLabel}>
            {topIds.has(t.taskId) ? <Text style={s.badge}>優先</Text> : null}
            <Text>{t.name}</Text>
          </View>
          <View style={s.barArea}>
            {/* 右側に金額ラベルの幅を残して比例させる */}
            <View style={[s.bar, { width: `${Math.max(0.4, (t.annualSavedAmount / max) * 82)}%` }]} />
            <Text style={s.barValue}>{formatYen(t.annualSavedAmount)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
