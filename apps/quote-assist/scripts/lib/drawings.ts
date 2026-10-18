import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { DetailView, DrawingSpec, PlateView, ShaftView } from "../../src/lib/demo/scenarios";

// デモ用の簡易な2D図面(表題欄+寸法+注記)。A4横、単位はpt(1mm ≒ 2.83pt)。

const PAGE = { width: 842, height: 595 };
const INK = rgb(0.1, 0.1, 0.1);
const THIN = 0.6;

/** 描画先。PDFに描くか、使う文字を集めるだけか(フォントのサブセット作成用) */
interface Canvas {
  text(value: string, x: number, y: number, size?: number): void;
  width(value: string, size: number): number;
  line(x1: number, y1: number, x2: number, y2: number, opts?: { dash?: number[]; width?: number }): void;
  rect(x: number, y: number, w: number, h: number, opts?: { dash?: number[]; width?: number }): void;
  circle(x: number, y: number, r: number): void;
}

class PdfCanvas implements Canvas {
  constructor(
    private page: PDFPage,
    private font: PDFFont,
  ) {}
  text(value: string, x: number, y: number, size = 9) {
    if (value) this.page.drawText(value, { x, y, size, font: this.font, color: INK });
  }
  width(value: string, size: number) {
    return this.font.widthOfTextAtSize(value, size);
  }
  line(x1: number, y1: number, x2: number, y2: number, opts: { dash?: number[]; width?: number } = {}) {
    this.page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: opts.width ?? THIN,
      color: INK,
      dashArray: opts.dash,
    });
  }
  rect(x: number, y: number, w: number, h: number, opts: { dash?: number[]; width?: number } = {}) {
    this.page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: INK,
      borderWidth: opts.width ?? THIN,
      borderDashArray: opts.dash,
    });
  }
  circle(x: number, y: number, r: number) {
    this.page.drawCircle({ x, y, size: r, borderColor: INK, borderWidth: THIN });
  }
}

export class CollectCanvas implements Canvas {
  readonly chars = new Set<string>();
  text(value: string) {
    for (const ch of value) this.chars.add(ch);
  }
  width(value: string, size: number) {
    return value.length * size;
  }
  line() {}
  rect() {}
  circle() {}
}

function drawTitleBlock(c: Canvas, spec: DrawingSpec) {
  const t = spec.title;
  const w = 340;
  const rowH = 17;
  const x = PAGE.width - 25 - w;
  const rows: [string, string, string?, string?][] = [
    ["品名", t.partName, "図番", t.drawingNumber],
    ["材質", t.material, "版", t.revision],
    ["数量", t.quantity, "尺度", t.scale],
    ["表面処理", t.surface],
    ["熱処理", t.heat],
    ["単位", "mm", "シート", `${spec.sheet.index}/${spec.sheet.total}`],
    ["作成日", t.drawnAt, "", ""],
  ];
  const h = rowH * (rows.length + 2);
  const y0 = 25;
  c.rect(x, y0, w, h, { width: 1.2 });
  // 1行目:顧客(図面の発行元)
  let y = y0 + h - rowH;
  c.line(x, y, x + w, y);
  c.text(t.customer, x + 8, y + 5, 10);
  for (const [l1, v1, l2, v2] of rows) {
    y -= rowH;
    c.line(x, y, x + w, y);
    c.text(l1, x + 6, y + 5, 8);
    c.line(x + 58, y, x + 58, y + rowH);
    if (l2 === undefined) {
      c.text(v1, x + 64, y + 5, 9.5);
    } else {
      c.text(v1, x + 64, y + 5, 9.5);
      c.line(x + 200, y, x + 200, y + rowH);
      c.text(l2, x + 206, y + 5, 8);
      c.line(x + 248, y, x + 248, y + rowH);
      c.text(v2 ?? "", x + 254, y + 5, 9.5);
    }
  }
  // 最下段:設計・検図・承認
  const signs = [t.designer, t.checker, t.approver];
  signs.forEach((s, i) => {
    const sx = x + (w / 3) * i;
    if (i > 0) c.line(sx, y0, sx, y0 + rowH);
    c.text(s, sx + 6, y0 + 5, 8);
  });
}

function drawRevisions(c: Canvas, spec: DrawingSpec) {
  const w = 340;
  const x = PAGE.width - 25 - w;
  const rowH = 15;
  const top = PAGE.height - 25;
  const rows = [["版", "日付", "内容"], ...spec.revisions.map((r) => [r.rev, r.date, r.description])];
  c.rect(x, top - rowH * rows.length, w, rowH * rows.length);
  rows.forEach((row, i) => {
    const y = top - rowH * (i + 1);
    if (i > 0) c.line(x, y + rowH, x + w, y + rowH);
    c.text(row[0], x + 6, y + 4, 8);
    c.line(x + 30, y, x + 30, y + rowH);
    c.text(row[1], x + 36, y + 4, 8);
    c.line(x + 110, y, x + 110, y + rowH);
    c.text(row[2], x + 116, y + 4, 8);
  });
}

function drawNotes(c: Canvas, notes: string[]) {
  if (notes.length === 0) return;
  const x = PAGE.width - 25 - 340;
  let y = 490;
  c.text("注記", x, y, 10);
  for (const n of notes) {
    y -= 15;
    c.text(n, x, y, 8.5);
  }
}

/** 寸法線(両端に短い直角の線と、中央に寸法値) */
function dimH(c: Canvas, x1: number, x2: number, y: number, label: string) {
  c.line(x1, y, x2, y);
  c.line(x1, y - 4, x1, y + 4);
  c.line(x2, y - 4, x2, y + 4);
  c.text(label, (x1 + x2) / 2 - c.width(label, 9) / 2, y + 3, 9);
}
function dimV(c: Canvas, x: number, y1: number, y2: number, label: string) {
  c.line(x, y1, x, y2);
  c.line(x - 4, y1, x + 4, y1);
  c.line(x - 4, y2, x + 4, y2);
  c.text(label, x + 6, (y1 + y2) / 2 - 3, 9);
}

function drawPlate(c: Canvas, v: PlateView) {
  // 左側(x 40〜450)に正面図と側面図を並べる。右側は版歴・注記・表題欄
  const s = Math.min(270 / v.lengthMm, 200 / v.widthMm, 2.6);
  const ox = 60;
  const W = v.lengthMm * s;
  const H = v.widthMm * s;
  const oy = 340 - H / 2;
  c.text("正面図", ox, oy + H + 30, 10);
  c.rect(ox, oy, W, H, { width: 1.2 });
  for (const h of v.holes) c.circle(ox + h.xMm * s, oy + h.yMm * s, (h.diameterMm / 2) * s);
  for (const t of v.taps) {
    const cx = ox + t.xMm * s;
    const cy = oy + t.yMm * s;
    c.circle(cx, cy, 2.5 * s);
    c.line(cx - 4, cy, cx + 4, cy, { width: 0.3 });
    c.line(cx, cy - 4, cx, cy + 4, { width: 0.3 });
  }
  if (v.pocket) {
    const p = v.pocket;
    c.rect(ox + p.xMm * s, oy + p.yMm * s, p.wMm * s, p.hMm * s, { dash: [3, 2] });
    c.text(p.label, ox + p.xMm * s, oy - 46, 8.5);
  }
  // 穴・タップの引出し
  const h0 = v.holes[0];
  c.text(v.holeLabel, ox + h0.xMm * s - 10, oy + h0.yMm * s + (h0.diameterMm / 2) * s + 6, 9);
  const t0 = v.taps[v.taps.length - 1];
  if (t0) c.text(v.tapLabel, ox + t0.xMm * s + 8, oy + t0.yMm * s + 6, 9);
  // 寸法
  dimH(c, ox, ox + W, oy - 22, v.labels.length);
  dimV(c, ox + W + 18, oy, oy + H, v.labels.width);
  if (v.pitchLabel && v.holes.length >= 2) {
    const a = v.holes[0];
    const b = v.holes[1];
    dimH(c, ox + a.xMm * s, ox + b.xMm * s, oy + H + 12, v.pitchLabel);
  }
  // 側面図(厚さ)
  const sx = ox + W + 60;
  const T = v.thicknessMm * s;
  c.text("側面図", sx, oy + H + 30, 10);
  c.rect(sx, oy, T, H, { width: 1.2 });
  dimH(c, sx, sx + T, oy - 22, v.labels.thickness);
}

function drawShaft(c: Canvas, v: ShaftView) {
  const total = v.steps.reduce((s, x) => s + x.lengthMm, 0);
  const maxD = Math.max(...v.steps.map((x) => x.diameterMm));
  const s = Math.min(380 / total, 120 / maxD, 2.6);
  const ox = 50;
  const cy = 360;
  c.text("正面図", ox, cy + (maxD / 2) * s + 50, 10);
  c.line(ox - 15, cy, ox + total * s + 15, cy, { dash: [12, 3, 2, 3], width: 0.4 });
  let x = ox;
  for (const step of v.steps) {
    const w = step.lengthMm * s;
    const h = step.diameterMm * s;
    c.rect(x, cy - h / 2, w, h, { width: 1.2 });
    c.text(step.label, x + w / 2 - c.width(step.label, 9) / 2, cy + h / 2 + 8, 9);
    x += w;
  }
  const k = v.keyway;
  const topOfKey = cy + (v.steps[1]?.diameterMm ?? maxD) / 2 * s;
  c.rect(ox + k.fromMm * s, topOfKey - 3.5 * s, k.lengthMm * s, 3.5 * s, { dash: [3, 2] });
  c.text(k.label, ox + k.fromMm * s, topOfKey + 22, 9);
  dimH(c, ox, ox + total * s, cy - (maxD / 2) * s - 26, v.lengthLabel);
}

function drawDetail(c: Canvas, v: DetailView) {
  const ox = 60;
  const oy = 320;
  c.text(v.title, ox, oy + 190, 10);
  c.rect(ox, oy, 260, 170, { width: 1.2 });
  c.rect(ox + 60, oy + 45, 140, 80, { dash: [3, 2] });
  v.lines.forEach((line, i) => c.text(line, ox + 70, oy + 105 - i * 16, 9));
}

export function drawSheet(c: Canvas, spec: DrawingSpec) {
  c.rect(15, 15, PAGE.width - 30, PAGE.height - 30, { width: 1.5 });
  drawTitleBlock(c, spec);
  drawRevisions(c, spec);
  drawNotes(c, spec.notes);
  if (spec.view.kind === "plate") drawPlate(c, spec.view);
  else if (spec.view.kind === "shaft") drawShaft(c, spec.view);
  else drawDetail(c, spec.view);
  c.text("この図面はデモ用の架空データです", 25, 25, 7);
}

// PDFの作成日時を固定して、同じ入力からは同じファイルを作る
const FIXED_DATE = new Date("2026-10-18T00:00:00Z");

export async function renderDrawingPdf(spec: DrawingSpec, fontBytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // サブセット済みのフォントをそのまま埋め込む(pdf-lib側のサブセット処理は日本語で字形が欠けるため使わない)
  const font = await doc.embedFont(fontBytes, { subset: false });
  doc.setTitle(`${spec.title.drawingNumber} Rev.${spec.title.revision} ${spec.title.partName}`);
  doc.setSubject(`sheet ${spec.sheet.index}/${spec.sheet.total}`);
  doc.setProducer("quote-assist demo data generator");
  doc.setCreator("quote-assist");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  drawSheet(new PdfCanvas(page, font), spec);
  return doc.save({ useObjectStreams: false });
}
