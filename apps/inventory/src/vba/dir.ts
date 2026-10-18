// [MS-OVBA] 2.3.4.2 dir Stream の解析。各レコードは Id(2) + Size(4) + Data の形をしている。
import { decodeText, decodeUtf16 } from "./codepage";
import { VbaFormatError } from "./decompress";

export interface DirReference {
  name: string;
  kind: "registered" | "project" | "control" | "original";
  libid: string;
}

export interface DirModule {
  name: string;
  streamName: string;
  offset: number;
  procedural: boolean;
  readOnly: boolean;
  private: boolean;
  docString: string;
}

export interface DirInfo {
  sysKind: number | null;
  codePage: number;
  projectName: string;
  docString: string;
  references: DirReference[];
  modules: DirModule[];
}

export function parseDirStream(buf: Uint8Array): DirInfo {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const info: DirInfo = {
    sysKind: null,
    codePage: 1252,
    projectName: "",
    docString: "",
    references: [],
    modules: [],
  };
  const text = (data: Uint8Array) => decodeText(data, info.codePage);

  let pendingRefName = "";
  let pendingRefNameUnicode = "";
  let afterControl = false;
  let lastOriginal: DirReference | null = null;
  let lastControl: DirReference | null = null;
  let mod: (DirModule & { nameUnicode?: string; streamNameUnicode?: string }) | null = null;

  const pushRef = (kind: DirReference["kind"], libid: string) => {
    const ref: DirReference = { name: pendingRefNameUnicode || pendingRefName, kind, libid };
    info.references.push(ref);
    pendingRefName = "";
    pendingRefNameUnicode = "";
    return ref;
  };
  const libidAt = (data: Uint8Array, at = 0) => {
    if (data.length < at + 4) return "";
    const size = new DataView(data.buffer, data.byteOffset + at, 4).getUint32(0, true);
    return text(data.subarray(at + 4, at + 4 + size));
  };

  let pos = 0;
  while (pos + 6 <= buf.length) {
    const id = view.getUint16(pos, true);
    const size = view.getUint32(pos + 2, true);
    pos += 6;
    if (id === 0x0009) {
      // PROJECTVERSION: Size は Reserved で常に 4。実データは Major(4) + Minor(2) の 6 バイト
      pos += 6;
      continue;
    }
    if (pos + size > buf.length) {
      throw new VbaFormatError(`dir ストリームのレコードが途中で切れています(id=0x${id.toString(16)})`);
    }
    const data = buf.subarray(pos, pos + size);
    pos += size;
    const u16 = () => (data.length >= 2 ? data[0] | (data[1] << 8) : 0);
    const u32 = () => (data.length >= 4 ? new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true) : 0);

    switch (id) {
      case 0x0001:
        info.sysKind = u32();
        break;
      case 0x0003:
        info.codePage = u16();
        break;
      case 0x0004:
        info.projectName = text(data);
        break;
      case 0x0005:
        info.docString = text(data);
        break;
      case 0x0016: // REFERENCENAME(REFERENCECONTROL 直後は NameRecordExtended なので無視)
        if (!afterControl) pendingRefName = text(data);
        break;
      case 0x003e:
        if (!afterControl) pendingRefNameUnicode = decodeUtf16(data);
        break;
      case 0x0033: // REFERENCEORIGINAL: Size が LibidOriginal の長さ
        lastOriginal = pushRef("original", text(data));
        break;
      case 0x002f: // REFERENCECONTROL
        if (lastOriginal) {
          lastOriginal.kind = "control";
          lastControl = lastOriginal;
        } else {
          lastControl = pushRef("control", libidAt(data));
        }
        lastOriginal = null;
        afterControl = true;
        break;
      case 0x0030: // REFERENCECONTROL の拡張部。LibidExtended に実際のタイプライブラリが入る
        if (lastControl && (!lastControl.libid || lastControl.libid.includes("{00000000-0000-0000-0000-000000000000}"))) {
          lastControl.libid = libidAt(data);
        }
        afterControl = false;
        lastControl = null;
        break;
      case 0x000d:
        pushRef("registered", libidAt(data));
        lastOriginal = null;
        break;
      case 0x000e:
        pushRef("project", libidAt(data));
        lastOriginal = null;
        break;
      case 0x0019:
        mod = {
          name: text(data),
          streamName: "",
          offset: 0,
          procedural: true,
          readOnly: false,
          private: false,
          docString: "",
        };
        break;
      case 0x0047:
        if (mod) mod.nameUnicode = decodeUtf16(data);
        break;
      case 0x001a:
        if (mod) mod.streamName = text(data);
        break;
      case 0x0032:
        if (mod) mod.streamNameUnicode = decodeUtf16(data);
        break;
      case 0x001c:
        if (mod) mod.docString = text(data);
        break;
      case 0x0031:
        if (mod) mod.offset = u32();
        break;
      case 0x0021:
        if (mod) mod.procedural = true;
        break;
      case 0x0022:
        if (mod) mod.procedural = false;
        break;
      case 0x0025:
        if (mod) mod.readOnly = true;
        break;
      case 0x0028:
        if (mod) mod.private = true;
        break;
      case 0x002b: // MODULE Terminator
        if (mod) {
          const { nameUnicode, streamNameUnicode, ...rest } = mod;
          info.modules.push({
            ...rest,
            name: nameUnicode || rest.name,
            streamName: streamNameUnicode || rest.streamName || nameUnicode || rest.name,
          });
        }
        mod = null;
        break;
      case 0x0010: // dir ストリームの終端
        return info;
    }
  }
  return info;
}
