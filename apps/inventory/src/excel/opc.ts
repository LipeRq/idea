// OOXML(Open Packaging Conventions)の zip パッケージを読むための小さなヘルパー。
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

export interface Relationship {
  id: string;
  /** Type URI の末尾(worksheet、vbaProject など) */
  type: string;
  /** パッケージ内のパス。外部参照なら元の Target */
  target: string;
  external: boolean;
}

const ARRAY_TAGS = new Set([
  "Relationship",
  "sheet",
  "definedName",
  "externalReference",
  "connection",
  "sheetName",
  "Override",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ARRAY_TAGS.has(name),
});

export type XmlNode = any;

export class OpcPackage {
  private entries = new Map<string, Uint8Array>();

  constructor(zip: Uint8Array) {
    const files = unzipSync(zip);
    for (const [name, data] of Object.entries(files)) {
      this.entries.set(name.replace(/^\/+/, "").toLowerCase(), data);
    }
  }

  paths(): string[] {
    return [...this.entries.keys()];
  }

  bytes(path: string): Uint8Array | null {
    return this.entries.get(path.replace(/^\/+/, "").toLowerCase()) ?? null;
  }

  text(path: string): string | null {
    const b = this.bytes(path);
    if (!b) return null;
    // UTF-8 の BOM を除く
    const start = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
    return strFromU8(b.subarray(start));
  }

  xml(path: string): XmlNode | null {
    const t = this.text(path);
    return t === null ? null : parser.parse(t);
  }

  rels(partPath: string): Relationship[] {
    const slash = partPath.lastIndexOf("/");
    const dir = slash >= 0 ? partPath.slice(0, slash) : "";
    const file = partPath.slice(slash + 1);
    const relsPath = `${dir ? `${dir}/` : ""}_rels/${file}.rels`;
    const doc = this.xml(relsPath);
    const list: XmlNode[] = doc?.Relationships?.Relationship ?? [];
    return list.map((r) => {
      const external = String(r.TargetMode ?? "").toLowerCase() === "external";
      const target = String(r.Target ?? "");
      return {
        id: String(r.Id ?? ""),
        type: String(r.Type ?? "").split("/").pop() ?? "",
        target: external ? target : resolvePartPath(dir, target),
        external,
      };
    });
  }
}

export function resolvePartPath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir ? baseDir.split("/") : [];
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}

export function decodeXmlText(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 要素のテキスト(属性付き要素は #text に入る)を取り出す */
export function nodeText(node: XmlNode): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string") return node;
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return null;
}
