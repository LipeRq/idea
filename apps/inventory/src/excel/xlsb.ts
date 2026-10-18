// .xlsb(バイナリブック)の解析。シート一覧・使用範囲・数式の件数・名前定義を BIFF12 レコードから読む。
import type { ControlMacro, DefinedName, ExternalLink, Sheet } from "../schema";
import { collectControlMacros, rangeRef, readExternalLink } from "./common";
import { rethrowIfFatal } from "../errors";
import type { Budget } from "../limits";
import type { OpcPackage } from "./opc";
import type { WorkbookParts } from "./ooxml";

const BRT_NAME = 0x27;
const BRT_WS_DIM = 0x94;
const BRT_WS_PROP = 0x93;
const BRT_WB_PROP = 0x99;
const BRT_BUNDLE_SH = 0x9c;
const BRT_FMLA = new Set([0x08, 0x09, 0x0a, 0x0b]);

export function* biff12Records(buf: Uint8Array, budget?: Budget): Generator<{ type: number; data: Uint8Array }> {
  let pos = 0;
  while (pos < buf.length) {
    budget?.check();
    let type = buf[pos++];
    if (type & 0x80) type = (type & 0x7f) | ((buf[pos++] & 0x7f) << 7);
    let size = 0;
    for (let i = 0; i < 4 && pos < buf.length; i++) {
      const b = buf[pos++];
      size |= (b & 0x7f) << (7 * i);
      if (!(b & 0x80)) break;
    }
    if (pos + size > buf.length) return;
    yield { type, data: buf.subarray(pos, pos + size) };
    pos += size;
  }
}

class Reader {
  pos: number;
  private view: DataView;
  constructor(private data: Uint8Array, pos = 0) {
    this.pos = pos;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** XLWideString / XLNullableWideString(文字数4バイト + UTF-16LE) */
  wideString(): string | null {
    if (this.pos + 4 > this.data.length) return null;
    const cch = this.u32();
    if (cch === 0xffffffff) return null;
    const bytes = this.data.subarray(this.pos, this.pos + cch * 2);
    this.pos += cch * 2;
    return new TextDecoder("utf-16le").decode(bytes);
  }
}

export function parseXlsbWorkbook(pkg: OpcPackage, workbookPath: string, warnings: string[]): WorkbookParts {
  const budget = pkg.budget;
  const wb = pkg.bytes(workbookPath) ?? new Uint8Array();
  const rels = pkg.rels(workbookPath);
  const relById = new Map(rels.map((r) => [r.id, r]));
  const codeNames = new Map<string, string>();
  const bundles: { name: string; state: number; relId: string | null }[] = [];
  const names: { name: string; itab: number; flags: number }[] = [];

  for (const rec of biff12Records(wb, budget)) {
    try {
      if (rec.type === BRT_BUNDLE_SH) {
        const r = new Reader(rec.data);
        const state = r.u32();
        r.u32(); // iTabID
        const relId = r.wideString();
        bundles.push({ name: r.wideString() ?? "", state, relId });
      } else if (rec.type === BRT_NAME) {
        const r = new Reader(rec.data);
        const flags = r.u32();
        r.pos += 1; // chKey
        const itab = r.u32();
        names.push({ name: r.wideString() ?? "", itab, flags });
      } else if (rec.type === BRT_WB_PROP) {
        const code = new Reader(rec.data, 8).wideString();
        if (code) codeNames.set(code.toLowerCase(), "ブック");
      }
    } catch (e) {
      rethrowIfFatal(e);
      warnings.push(`xlsb のレコード(0x${rec.type.toString(16)})を読めませんでした`);
    }
  }

  const sheets: Sheet[] = [];
  const controlMacros: ControlMacro[] = [];
  budget.cap(bundles, budget.limits.maxSheets, warnings, "シート").forEach((b, index) => {
    budget.checkNow();
    const rel = b.relId ? relById.get(b.relId) : undefined;
    const bin = rel && !rel.external ? pkg.bytes(rel.target) : null;
    let usedRange: string | null = null;
    let formulaCount = 0;
    let codeName: string | null = null;
    if (bin) {
      for (const rec of biff12Records(bin, budget)) {
        if (BRT_FMLA.has(rec.type)) formulaCount++;
        else if (rec.type === BRT_WS_DIM && rec.data.length >= 16) {
          const r = new Reader(rec.data);
          const [r1, r2, c1, c2] = [r.u32(), r.u32(), r.u32(), r.u32()];
          usedRange = rangeRef(r1, r2, c1, c2);
        } else if (rec.type === BRT_WS_PROP && rec.data.length > 19) {
          codeName = new Reader(rec.data, 19).wideString();
        }
      }
    }
    if (codeName) codeNames.set(codeName.toLowerCase(), `シート「${b.name}」`);
    sheets.push({
      name: b.name,
      codeName,
      index,
      kind: rel?.type === "chartsheet" ? "chartsheet" : rel?.type?.includes("acrosheet") ? "macrosheet" : rel?.type === "dialogsheet" ? "dialogsheet" : "worksheet",
      state: b.state === 1 ? "hidden" : b.state === 2 ? "veryHidden" : "visible",
      usedRange,
      formulaCount,
      formulaSamples: [],
      externalRefCount: 0,
      brokenRefCount: 0,
    });
    if (rel && !rel.external) controlMacros.push(...collectControlMacros(pkg, rel.target, b.name, null));
  });

  const definedNames: DefinedName[] = budget.cap(names, budget.limits.maxListItems, warnings, "名前定義").map((n) => ({
    name: n.name,
    scope: n.itab !== 0xffffffff ? (sheets[n.itab]?.name ?? String(n.itab)) : null,
    refersTo: null,
    hidden: (n.flags & 0x01) !== 0,
    builtIn: (n.flags & 0x20) !== 0 || n.name.startsWith("_xlnm."),
  }));

  const externalLinks: ExternalLink[] = budget
    .cap(rels.filter((r) => r.type === "externalLink" && !r.external), budget.limits.maxListItems, warnings, "外部リンク")
    .map((r, i) => readExternalLink(pkg, r.target, i + 1));
  if (rels.some((r) => r.type === "connections")) {
    warnings.push("xlsb 形式の外部データ接続(connections.bin)は内容を解析していません");
  }
  const vbaRel = rels.find((r) => r.type === "vbaProject");

  return {
    excel: {
      sheets,
      definedNames,
      externalLinks,
      connections: [],
      controlMacros,
      formulaCount: sheets.reduce((s, x) => s + x.formulaCount, 0),
      formulaTextAvailable: false,
    },
    vbaProjectPath: vbaRel && !vbaRel.external ? vbaRel.target : null,
    codeNames,
    credentialLocations: [],
  };
}
