// テスト用: [MS-OVBA] に沿って vbaProject.bin を組み立てる(圧縮・dir ストリーム・PROJECT ストリーム)。
import CFB, { type CFB$Container } from "cfb";
import iconv from "iconv-lite";
import { copyTokenBitCount } from "../../src/vba/decompress";

const CHUNK = 4096;

/** 2.4.1.3.7 Compression。一致検索は単純な全探索。 */
export function compress(data: Uint8Array): Uint8Array {
  const out: number[] = [0x01];
  for (let start = 0; start < data.length; start += CHUNK) {
    const chunk = data.subarray(start, start + CHUNK);
    const body = compressChunk(chunk);
    if (body.length <= 4096) {
      const header = (body.length + 2 - 3) | (0b011 << 12) | 0x8000;
      out.push(header & 0xff, header >> 8, ...body);
    } else {
      // 圧縮できないチャンクは非圧縮チャンク(常に 4096 バイト、足りない分は 0 埋め)
      out.push(0xff, 0x3f);
      for (let i = 0; i < CHUNK; i++) out.push(chunk[i] ?? 0);
    }
  }
  return Uint8Array.from(out);
}

function compressChunk(chunk: Uint8Array): number[] {
  const body: number[] = [];
  let pos = 0;
  while (pos < chunk.length) {
    const flagIndex = body.length;
    body.push(0);
    let flags = 0;
    for (let bit = 0; bit < 8 && pos < chunk.length; bit++) {
      const { offset, length } = longestMatch(chunk, pos);
      if (length >= 3) {
        const bitCount = copyTokenBitCount(pos);
        const token = ((offset - 1) << (16 - bitCount)) | (length - 3);
        body.push(token & 0xff, (token >> 8) & 0xff);
        flags |= 1 << bit;
        pos += length;
      } else {
        body.push(chunk[pos++]);
      }
    }
    body[flagIndex] = flags;
  }
  return body;
}

function longestMatch(chunk: Uint8Array, pos: number) {
  if (pos === 0) return { offset: 0, length: 0 };
  const bitCount = copyTokenBitCount(pos);
  const maxLength = (0xffff >> bitCount) + 3;
  const maxOffset = 1 << bitCount;
  let best = { offset: 0, length: 0 };
  for (let cand = pos - 1; cand >= Math.max(0, pos - maxOffset); cand--) {
    let len = 0;
    while (len < maxLength && pos + len < chunk.length && chunk[cand + len] === chunk[pos + len]) len++;
    if (len > best.length) best = { offset: pos - cand, length: len };
  }
  return best;
}

/** 2.4.3.2 Encryption(PROJECT ストリームの CMG / DPB / GC の値) */
export function encryptProjectData(data: Uint8Array, projectId: string, seed = 0x5a): string {
  const out: number[] = [];
  const projKey = [...projectId].reduce((s, c) => (s + c.charCodeAt(0)) & 0xff, 0);
  const versionEnc = seed ^ 2;
  const projKeyEnc = seed ^ projKey;
  out.push(seed, versionEnc, projKeyEnc);
  let unencrypted1 = projKey;
  let encrypted1 = projKeyEnc;
  let encrypted2 = versionEnc;
  const push = (byte: number) => {
    const enc = (byte ^ ((encrypted2 + unencrypted1) & 0xff)) & 0xff;
    out.push(enc);
    encrypted2 = encrypted1;
    encrypted1 = enc;
    unencrypted1 = byte;
  };
  for (let i = 0; i < (seed & 6) / 2; i++) push(0x11 * (i + 1));
  for (let i = 0; i < 4; i++) push((data.length >> (8 * i)) & 0xff);
  for (const b of data) push(b);
  return out.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
}

export type TestModuleType = "standard" | "class" | "document" | "form";

export interface TestModule {
  name: string;
  type: TestModuleType;
  /** Attribute 行を除いたソース(改行は \n) */
  code: string;
  /** VB_Base など追加の Attribute 行 */
  attributes?: string[];
}

export interface TestProject {
  name?: string;
  codePage?: number;
  modules: TestModule[];
  locked?: boolean;
  /** PROJECT ストリームを入れない(dir と VB_Base だけで種別を判定させる) */
  omitProjectStream?: boolean;
}

const enc = (s: string, cp: number) => iconv.encode(s, cp === 65001 ? "utf8" : `cp${cp}`);
const utf16 = (s: string) => iconv.encode(s, "utf16le");

class RecordWriter {
  bytes: number[] = [];
  u16(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff);
  }
  u32(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  }
  raw(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i]);
  }
  rec(id: number, data: ArrayLike<number> = []) {
    this.u16(id);
    this.u32(data.length);
    this.raw(data);
  }
}

const u32le = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const u16le = (v: number) => [v & 0xff, (v >> 8) & 0xff];

const BASES: Record<string, string> = {
  ThisWorkbook: "0{00020819-0000-0000-C000-000000000046}",
  sheet: "0{00020820-0000-0000-C000-000000000046}",
  form: "0{C62A69F0-16DC-11CE-9E98-00AA00574A4F}{8B6F3A3C-1D2C-4C5A-8E3F-6B0E1F3A2B10}",
};

function attributeLines(m: TestModule): string[] {
  const lines = [`Attribute VB_Name = "${m.name}"`];
  if (m.type === "document") {
    lines.push(`Attribute VB_Base = "${m.name === "ThisWorkbook" ? BASES.ThisWorkbook : BASES.sheet}"`);
  } else if (m.type === "form") {
    lines.push(`Attribute VB_Base = "${BASES.form}"`);
  }
  if (m.type !== "standard") {
    lines.push(
      "Attribute VB_GlobalNameSpace = False",
      "Attribute VB_Creatable = False",
      `Attribute VB_PredeclaredId = ${m.type === "class" ? "False" : "True"}`,
      "Attribute VB_Exposed = False",
    );
  }
  return [...lines, ...(m.attributes ?? [])];
}

export function buildDirStream(project: TestProject, offsets: number[]): Uint8Array {
  const cp = project.codePage ?? 932;
  const name = project.name ?? "VBAProject";
  const w = new RecordWriter();
  w.rec(0x0001, u32le(1)); // SysKind: Win32
  w.rec(0x004a, u32le(0x6b)); // PROJECTCOMPATVERSION
  w.rec(0x0002, u32le(0x0411)); // LCID ja-JP
  w.rec(0x0014, u32le(0x0411));
  w.rec(0x0003, u16le(cp));
  w.rec(0x0004, enc(name, cp));
  w.rec(0x0005, enc("テスト用プロジェクト", cp));
  w.rec(0x0040, utf16("テスト用プロジェクト"));
  w.rec(0x0006);
  w.rec(0x003d);
  w.rec(0x0007, u32le(0));
  w.rec(0x0008, u32le(0));
  // PROJECTVERSION: Size フィールドは Reserved(4)、その後に Major(4) + Minor(2)
  w.u16(0x0009);
  w.u32(4);
  w.raw(u32le(1525720264));
  w.raw(u16le(9));
  w.rec(0x000c);
  w.rec(0x003c);

  // 参照設定: stdole(REFERENCEREGISTERED)
  const stdole = "*\\G{00020430-0000-0000-C000-000000000046}#2.0#0#C:\\Windows\\System32\\stdole2.tlb#OLE Automation";
  w.rec(0x0016, enc("stdole", cp));
  w.rec(0x003e, utf16("stdole"));
  w.rec(0x000d, [...u32le(stdole.length), ...enc(stdole, cp), ...u32le(0), ...u16le(0)]);

  // 参照設定: ADODB(REFERENCEREGISTERED)
  const ado =
    "*\\G{B691E011-1797-432E-907A-4D8C69339129}#6.1#0#C:\\Program Files\\Common Files\\System\\ado\\msado15.dll#Microsoft ActiveX Data Objects 6.1 Library";
  w.rec(0x0016, enc("ADODB", cp));
  w.rec(0x003e, utf16("ADODB"));
  w.rec(0x000d, [...u32le(ado.length), ...enc(ado, cp), ...u32le(0), ...u16le(0)]);

  // 参照設定: MSForms(REFERENCEORIGINAL + REFERENCECONTROL)
  const original = "*\\G{0D452EE1-E08F-101A-852E-02608C4D0BB4}#2.0#0#C:\\Windows\\System32\\FM20.DLL#Microsoft Forms 2.0 Object Library";
  const twiddled = "*\\G{00000000-0000-0000-0000-000000000000}#0.0#0##";
  const extended = "*\\G{0D452EE1-E08F-101A-852E-02608C4D0BB4}#2.0#0#C:\\Windows\\System32\\FM20.DLL#Microsoft Forms 2.0 Object Library";
  w.rec(0x0016, enc("MSForms", cp));
  w.rec(0x003e, utf16("MSForms"));
  w.rec(0x0033, enc(original, cp));
  w.rec(0x002f, [...u32le(twiddled.length), ...enc(twiddled, cp), ...u32le(0), ...u16le(0)]);
  w.rec(0x0016, enc("MSForms", cp)); // NameRecordExtended
  w.rec(0x003e, utf16("MSForms"));
  w.rec(0x0030, [...u32le(extended.length), ...enc(extended, cp), ...u32le(0), ...u16le(0), ...new Array(16).fill(0x11), ...u32le(0)]);

  w.rec(0x000f, u16le(project.modules.length));
  w.rec(0x0013, u16le(0xffff));
  project.modules.forEach((m, i) => {
    w.rec(0x0019, enc(m.name, cp));
    w.rec(0x0047, utf16(m.name));
    w.rec(0x001a, enc(m.name, cp));
    w.rec(0x0032, utf16(m.name));
    w.rec(0x001c);
    w.rec(0x0048);
    w.rec(0x0031, u32le(offsets[i]));
    w.rec(0x001e, u32le(0));
    w.rec(0x002c, u16le(0xffff));
    w.rec(m.type === "standard" ? 0x0021 : 0x0022);
    w.rec(0x002b);
  });
  w.rec(0x0010);
  return Uint8Array.from(w.bytes);
}

export const PROJECT_ID = "{3B1C5A2D-0F4E-4B7A-9C11-2D3E4F5A6B7C}";

export function buildProjectStream(project: TestProject): Uint8Array {
  const cp = project.codePage ?? 932;
  const lines = [`ID="${PROJECT_ID}"`];
  for (const m of project.modules) {
    if (m.type === "document") lines.push(`Document=${m.name}/&H00000000`);
    else if (m.type === "standard") lines.push(`Module=${m.name}`);
    else if (m.type === "class") lines.push(`Class=${m.name}`);
    else lines.push(`BaseClass=${m.name}`);
  }
  const locked = project.locked ?? false;
  lines.push(
    `Name="${project.name ?? "VBAProject"}"`,
    'HelpContextID="0"',
    'VersionCompatible32="393222000"',
    `CMG="${encryptProjectData(Uint8Array.from(u32le(locked ? 1 : 0)), PROJECT_ID, 0x34)}"`,
    `DPB="${encryptProjectData(locked ? Uint8Array.from({ length: 29 }, (_, i) => i + 1) : Uint8Array.of(0), PROJECT_ID, 0x16)}"`,
    `GC="${encryptProjectData(Uint8Array.of(locked ? 0x00 : 0xff), PROJECT_ID, 0x72)}"`,
    "",
    "[Host Extender Info]",
    "&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000",
    "",
    "[Workspace]",
    ...project.modules.map((m) => `${m.name}=0, 0, 0, 0, C`),
    "",
  );
  return enc(lines.join("\r\n"), cp);
}

/** モジュールのソースを圧縮し、前に擬似的な PerformanceCache を付けたストリームを作る */
export function buildModuleStream(m: TestModule, cp: number): { stream: Uint8Array; offset: number } {
  const text = [...attributeLines(m), ...m.code.split("\n")].join("\r\n") + "\r\n";
  const compressed = compress(enc(text, cp));
  const cacheLength = 37 + m.name.length;
  const stream = new Uint8Array(cacheLength + compressed.length);
  for (let i = 0; i < cacheLength; i++) stream[i] = (i * 7 + 3) & 0xff;
  stream.set(compressed, cacheLength);
  return { stream, offset: cacheLength };
}

/** VBAプロジェクトのストリーム一式(ストレージ内の相対パス → 内容) */
export function buildVbaStreams(project: TestProject): Map<string, Uint8Array> {
  const cp = project.codePage ?? 932;
  const streams = new Map<string, Uint8Array>();
  const offsets: number[] = [];
  for (const m of project.modules) {
    const { stream, offset } = buildModuleStream(m, cp);
    streams.set(`VBA/${m.name}`, stream);
    offsets.push(offset);
  }
  streams.set("VBA/dir", compress(buildDirStream(project, offsets)));
  streams.set("VBA/_VBA_PROJECT", Uint8Array.of(0xcc, 0x61, 0xff, 0xff, 0x00, 0x00, 0x00));
  if (!project.omitProjectStream) streams.set("PROJECT", buildProjectStream(project));
  streams.set("PROJECTwm", Uint8Array.of(0, 0));
  return streams;
}

export function addStreams(container: CFB$Container, root: string, streams: Map<string, Uint8Array>) {
  for (const [path, data] of streams) {
    CFB.utils.cfb_add(container, `/${root ? `${root}/` : ""}${path}`, Buffer.from(data));
  }
}

export function buildVbaProjectBin(project: TestProject): Uint8Array {
  const container = CFB.utils.cfb_new();
  addStreams(container, "", buildVbaStreams(project));
  return new Uint8Array(CFB.write(container, { type: "buffer", fileType: "cfb" }) as Buffer);
}
