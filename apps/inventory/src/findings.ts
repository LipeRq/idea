// 抽出結果から機械的に判定できるリスク(属人化・環境依存・保守性)を洗い出す。
import type { Dependency, Finding, InventoryReport, Location } from "./schema";

const LONG_PROCEDURE_LINES = 200;

type Input = Pick<InventoryReport, "excel" | "access" | "vba" | "dependencies" | "callGraph" | "entryPoints">;

export function detectFindings(
  r: Input,
  extra: { credentialLocations: string[]; sourceCredentialLocations?: Location[] },
): Finding[] {
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, "count"> & { count?: number }) => {
    const count = f.count ?? f.locations.length;
    if (count > 0) findings.push({ ...f, count });
  };
  const deps = (kind: Dependency["kind"], pred: (d: Dependency) => boolean = () => true) =>
    r.dependencies.filter((d) => d.kind === kind && pred(d));
  const locs = (list: Dependency[]) => list.map((d) => d.location);

  const modules = r.vba?.modules ?? [];
  const procedures = modules.flatMap((m) => m.procedures.map((p) => ({ m, p })));

  // #If VBA7 Then … #Else の #Else 側など、64ビット版では使われない分岐の Declare は対象外
  const noPtrSafe = modules.flatMap((m) =>
    m.declares.filter((d) => !d.ptrSafe && !d.legacyBranch).map((d): Location => ({ module: m.name, line: d.line })),
  );
  add({
    ruleId: "VBA-API-64BIT",
    severity: "high",
    title: "Declare 文に PtrSafe がない",
    detail: "64ビット版のOfficeではコンパイルエラーになり、マクロ全体が動きません。PtrSafe と LongPtr への書き換えが必要です。",
    locations: noPtrSafe,
  });

  const credentials = deps("connectionString", (d) => d.category === "認証情報を含む");
  const credentialLocations = new Map<string, Location>();
  for (const l of [...locs(credentials), ...(extra.sourceCredentialLocations ?? []), ...extra.credentialLocations.map((p): Location => ({ part: p }))]) {
    const key = l.module ? `${l.module}\u0000${l.line ?? ""}` : `part\u0000${l.part ?? ""}`;
    if (!credentialLocations.has(key)) credentialLocations.set(key, l);
  }
  add({
    ruleId: "CRED-HARDCODED",
    severity: "high",
    title: "パスワードが接続文字列やコードに直接書かれている",
    detail: "ファイルを開ける人なら誰でも認証情報(DBの接続、シートやブックの保護など)を読めます。移行時は資格情報の管理方法を見直してください(出力では伏せ字にしています)。",
    locations: [...credentialLocations.values()],
  });

  add({
    ruleId: "IE-AUTOMATION",
    severity: "high",
    title: "Internet Explorer を自動操作している",
    detail: "IE はサポートが終了しており、Windows の更新で動かなくなる可能性が高い処理です。",
    locations: locs(deps("createObject", (d) => /InternetExplorer/i.test(d.target))),
  });

  const macroSheets = r.excel?.sheets.filter((s) => s.kind === "macrosheet") ?? [];
  add({
    ruleId: "XLM-MACRO",
    severity: "high",
    title: "Excel 4.0 マクロシート(XLM)がある",
    detail: "古い形式のマクロで、セキュリティ上の理由から既定でブロックされることがあります。",
    locations: macroSheets.map((s): Location => ({ part: `シート「${s.name}」` })),
  });

  add({
    ruleId: "SENDKEYS",
    severity: "medium",
    title: "SendKeys でキー操作を送っている",
    detail: "画面の状態やタイミングに依存するため、環境が変わると誤動作しやすい処理です。",
    locations: locs(deps("sendKeys")),
  });

  add({
    ruleId: "SHELL",
    severity: "medium",
    title: "外部プログラムを起動している(Shell)",
    detail: "起動するプログラムが他のPCにもあるか、実行権限があるかに依存します。",
    locations: locs([...deps("shell"), ...deps("createObject", (d) => d.category === "外部プログラム・OS操作")]),
  });

  const paths = deps("filePath", (d) => d.category !== "ファイル名");
  add({
    ruleId: "HARDCODED-PATH",
    severity: "medium",
    title: "ファイルパスがコードに直接書かれている",
    detail: "特定のPCやフォルダ構成に依存しています。担当者の異動やPC入れ替えで動かなくなる典型的な原因です。",
    locations: locs(paths),
  });

  const resumeNext = procedures.filter(({ p }) => p.errorHandling === "resumeNext");
  add({
    ruleId: "RESUME-NEXT",
    severity: "medium",
    title: "On Error Resume Next でエラーを握りつぶしている",
    detail: "失敗しても処理が続くため、誤ったデータのまま完了したように見える恐れがあります。",
    locations: resumeNext.map(({ m, p }) => ({ module: m.name, procedure: p.name, line: p.startLine })),
  });

  const externalProcs = new Set(
    r.dependencies
      .filter((d) => d.location.procedure && d.location.module && !["reference", "winApi", "sql"].includes(d.kind))
      .map((d) => `${d.location.module}.${d.location.procedure}`),
  );
  const unhandled = procedures.filter(({ p }) => p.errorHandling === "none" && externalProcs.has(p.id));
  add({
    ruleId: "NO-ERROR-HANDLING",
    severity: "medium",
    title: "外部とやり取りするのにエラー処理がない",
    detail: "ファイルが無い・接続できない等のときにマクロが途中で止まり、作業が中途半端な状態で残ります。",
    locations: unhandled.map(({ m, p }) => ({ module: m.name, procedure: p.name, line: p.startLine })),
  });

  const long = procedures.filter(({ p }) => p.lineCount > LONG_PROCEDURE_LINES);
  add({
    ruleId: "LONG-PROCEDURE",
    severity: "medium",
    title: `${LONG_PROCEDURE_LINES}行を超える長いプロシージャ`,
    detail: "処理が1か所に集中しており、読み解き・修正の難易度が高い部分です。",
    locations: long.map(({ m, p }) => ({ module: m.name, procedure: p.name, line: p.startLine })),
  });

  add({
    ruleId: "EXTERNAL-LINK",
    severity: "medium",
    title: "他のブックを数式で参照している",
    detail: "参照先ファイルの移動・改名でリンク切れになります。参照先も棚卸しの対象です。",
    locations: (r.excel?.externalLinks ?? []).map((l): Location => ({ part: l.target })),
  });

  add({
    ruleId: "DATA-CONNECTION",
    severity: "medium",
    title: "外部データ接続がある",
    detail: "接続先(DB・Web・ファイル)と認証方法を確認してください。",
    locations: (r.excel?.connections ?? []).map((c): Location => ({ part: `${c.type}: ${c.name}` })),
  });

  add({
    ruleId: "LINKED-TABLE",
    severity: "medium",
    title: "リンクテーブルで外部のデータを参照している",
    detail: "参照先(別のAccessファイル・ODBC・Excel等)が無いと動きません。参照先も棚卸しの対象です。",
    locations: (r.access?.linkedTables ?? []).map((t): Location => ({ part: `${t.name} → ${t.database ?? t.connect ?? ""}` })),
  });

  add({
    ruleId: "WIN-API",
    severity: "low",
    title: "Windows API を直接呼び出している",
    detail: "Windows 以外(Mac版Excel・クラウド)では動きません。移行時は代替手段が必要です。",
    locations: modules.flatMap((m) => m.declares.map((d): Location => ({ module: m.name, line: d.line }))),
  });

  add({
    ruleId: "NO-OPTION-EXPLICIT",
    severity: "low",
    title: "Option Explicit が宣言されていないモジュール",
    detail: "変数名の打ち間違いがエラーにならず、不具合の原因になります。",
    locations: modules
      .filter((m) => !m.hasOptionExplicit && m.procedures.length > 0)
      .map((m): Location => ({ module: m.name })),
  });

  const veryHidden = r.excel?.sheets.filter((s) => s.state === "veryHidden") ?? [];
  add({
    ruleId: "VERY-HIDDEN-SHEET",
    severity: "low",
    title: "完全に非表示(xlSheetVeryHidden)のシートがある",
    detail: "Excelの画面からは再表示できないシートです。設定値やマスタが隠されていることがあります。",
    locations: veryHidden.map((s): Location => ({ part: `シート「${s.name}」` })),
  });

  const brokenNames = r.excel?.definedNames.filter((n) => n.refersTo?.includes("#REF!")) ?? [];
  const brokenSheets = r.excel?.sheets.filter((s) => s.brokenRefCount > 0) ?? [];
  add({
    ruleId: "BROKEN-REF",
    severity: "low",
    title: "#REF! を含む数式・名前定義がある",
    detail: "参照先が削除された跡です。使われていない名前定義は整理の候補です。",
    locations: [
      ...brokenNames.map((n): Location => ({ part: `名前定義「${n.name}」` })),
      ...brokenSheets.map((s): Location => ({ part: `シート「${s.name}」(${s.brokenRefCount}件)` })),
    ],
  });

  const called = new Set(r.callGraph.map((e) => e.to));
  const entry = new Set(r.entryPoints.map((e) => e.procedure));
  const unused = procedures.filter(
    ({ m, p }) => p.scope === "private" && !p.isEvent && !called.has(p.id) && !entry.has(p.id) && m.type !== "class",
  );
  add({
    ruleId: "UNUSED-PRIVATE",
    severity: "low",
    title: "どこからも呼ばれていない Private プロシージャ",
    detail: "使われていない可能性があるコードです(文字列で呼び出している場合は検出できません)。",
    locations: unused.map(({ m, p }) => ({ module: m.name, procedure: p.name, line: p.startLine })),
  });

  if (r.vba?.lockedForViewing) {
    add({
      ruleId: "VBA-LOCKED",
      severity: "low",
      title: "VBAプロジェクトが表示用にロックされている",
      detail: "パスワードを知っている人しかVBEでコードを見られません。パスワードの管理者を確認してください(本ツールはロックされていても解析できます)。",
      locations: [{ part: "VBAプロジェクト" }],
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
