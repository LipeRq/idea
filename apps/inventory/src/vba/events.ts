import type { ModuleType } from "../schema";

const AUTO_MACROS: Record<string, string> = {
  auto_open: "ブックを開いたとき(Auto_Open)",
  auto_close: "ブックを閉じるとき(Auto_Close)",
  auto_activate: "ブックがアクティブになったとき(Auto_Activate)",
  auto_deactivate: "ブックが非アクティブになったとき(Auto_Deactivate)",
};

const EVENT_LABEL: Record<string, string> = {
  open: "開いたとき",
  close: "閉じたとき",
  beforeclose: "閉じる前",
  beforesave: "保存する前",
  aftersave: "保存した後",
  activate: "アクティブになったとき",
  deactivate: "非アクティブになったとき",
  change: "値が変更されたとき",
  selectionchange: "選択範囲が変わったとき",
  calculate: "再計算されたとき",
  beforedoubleclick: "ダブルクリックしたとき",
  beforerightclick: "右クリックしたとき",
  beforeprint: "印刷する前",
  newsheet: "シートを追加したとき",
  sheetchange: "いずれかのシートの値が変更されたとき",
  sheetactivate: "シートを切り替えたとき",
  sheetselectionchange: "いずれかのシートで選択範囲が変わったとき",
  sheetcalculate: "いずれかのシートが再計算されたとき",
  sheetbeforedoubleclick: "いずれかのシートでダブルクリックしたとき",
  followhyperlink: "ハイパーリンクをクリックしたとき",
  click: "クリックしたとき",
  dblclick: "ダブルクリックしたとき",
  initialize: "初期化されたとき(表示前)",
  terminate: "破棄されたとき",
  queryclose: "閉じる前",
  load: "読み込まれたとき",
  unload: "閉じるとき",
  current: "レコードを移動したとき",
  afterupdate: "更新された後",
  beforeupdate: "更新される前",
  enter: "フォーカスが移ったとき",
  exit: "フォーカスが外れたとき",
  gotfocus: "フォーカスを得たとき",
  lostfocus: "フォーカスを失ったとき",
  keydown: "キーを押したとき",
  keypress: "キーを押したとき",
  keyup: "キーを離したとき",
  mousedown: "マウスボタンを押したとき",
  mouseup: "マウスボタンを離したとき",
  mousemove: "マウスを動かしたとき",
  timer: "タイマー間隔ごと",
  format: "書式設定時",
  print: "印刷時",
  nodata: "データが無いとき",
  error: "エラー発生時",
  resize: "サイズが変わったとき",
  dirty: "編集が始まったとき",
  delete: "削除するとき",
  beforeinsert: "追加する前",
  afterinsert: "追加した後",
  notinlist: "リストに無い値が入力されたとき",
  dropbuttonclick: "ドロップダウンを開いたとき",
};

const OBJECT_LABEL: Record<string, string> = {
  workbook: "ブック",
  worksheet: "シート",
  chart: "グラフ",
  userform: "フォーム",
  form: "フォーム",
  report: "レポート",
  class: "クラス",
  detail: "詳細セクション",
};

export interface EventInfo {
  label: string;
  auto: boolean;
}

/** プロシージャ名からイベントプロシージャかどうかを判定する */
export function detectEvent(
  procName: string,
  moduleName: string,
  moduleType: ModuleType,
  withEvents: string[],
  sheetLabel?: string,
): EventInfo | null {
  const lower = procName.toLowerCase();
  if (moduleType === "standard") {
    return AUTO_MACROS[lower] ? { label: AUTO_MACROS[lower], auto: true } : null;
  }
  const sep = procName.lastIndexOf("_");
  if (sep <= 0 || sep === procName.length - 1) return null;
  const object = procName.slice(0, sep);
  const event = procName.slice(sep + 1).toLowerCase();
  const objectLower = object.toLowerCase();
  const isKnownObject = objectLower in OBJECT_LABEL;
  const isWithEvents = withEvents.some((w) => w.toLowerCase() === objectLower);
  // コントロールのイベント(CommandButton1_Click 等)はフォーム・シート等のモジュールにだけある
  const controlEvent = moduleType !== "class" && event in EVENT_LABEL;
  if (!isKnownObject && !isWithEvents && !controlEvent) return null;

  let objectLabel: string;
  if (objectLower === "worksheet" || objectLower === "chart") {
    objectLabel = sheetLabel ? `${OBJECT_LABEL[objectLower]}「${sheetLabel}」` : `${OBJECT_LABEL[objectLower]} ${moduleName}`;
  } else if (objectLower === "userform" || objectLower === "form" || objectLower === "report") {
    objectLabel = `${OBJECT_LABEL[objectLower]} ${moduleName.replace(/^(Form|Report)_/i, "")}`;
  } else if (isKnownObject) {
    objectLabel = OBJECT_LABEL[objectLower];
  } else {
    const owner = sheetLabel ? `シート「${sheetLabel}」` : moduleName.replace(/^(Form|Report)_/i, "");
    objectLabel = `${object}(${owner})`;
  }
  const eventLabel = EVENT_LABEL[event] ?? `${procName.slice(sep + 1)} イベント`;
  return { label: `${objectLabel} / ${eventLabel}`, auto: false };
}
