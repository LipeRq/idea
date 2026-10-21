import type { DependencyKind, EntryPointKind, InventoryReport } from "../../src/schema";
import type { WorkbookSpec } from "./workbook";

/** 解析したときに狙いどおり検出されることを確かめる項目 */
export interface SampleExpectation {
  /** 必ず検出されるリスク(ruleId) */
  findings: string[];
  /** 検出されてはいけないリスク(ruleId) */
  absentFindings?: string[];
  /** 必ず含まれる起動のきっかけの種類 */
  entryKinds: EntryPointKind[];
  /** 必ず含まれる外部依存の種類 */
  dependencyKinds: DependencyKind[];
  /** JSON・仕様書のどこにも残ってはいけない文字列(ダミーのパスワードなど) */
  secrets?: string[];
  /** 機械的な移行難易度の目安 */
  complexity?: "低" | "中" | "高";
  /** ルールで選ぶ移行先候補の先頭(前方一致) */
  firstMigration?: string;
  /** 個別の確認。問題があればそのメッセージを返す */
  checks?: (r: InventoryReport) => string[];
}

export interface SampleDefinition {
  /** 生成するファイル名(samples/ 直下) */
  file: string;
  /** manifest.json に載せる、画面に表示する名前 */
  title: string;
  /** manifest.json に載せる、どんな業務のファイルかの説明(1〜2 文) */
  description: string;
  /** manifest.json に載せる、解析で見どころになる点 */
  highlights: string[];
  workbook: WorkbookSpec;
  expect: SampleExpectation;
}
