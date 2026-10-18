// VBAプロジェクト(dir / PROJECT / モジュールストリーム)からソースコードを取り出す。
import type { CFB$Container } from "cfb";
import type { ModuleType, VbaReference } from "../schema";
import { decodeText, encodingForCodePage } from "./codepage";
import { decompressContainer } from "./decompress";
import { parseDirStream, type DirReference } from "./dir";
import { parseProjectStream } from "./projectStream";

/** VBAプロジェクトのストレージ(OLE複合ファイル、AccessのMSysAccessStorageなど)を抽象化したもの */
export interface VbaStorage {
  /** プロジェクトルートからの相対パス("VBA/dir"、"PROJECT" など)。大文字小文字は区別しない */
  read(path: string): Uint8Array | null;
}

export interface RawVbaModule {
  name: string;
  streamName: string;
  type: ModuleType;
  source: string;
  attributes: Record<string, string>;
}

export interface RawVbaProject {
  name: string;
  codePage: number;
  encoding: string;
  lockedForViewing: boolean | null;
  hasPassword: boolean | null;
  references: VbaReference[];
  modules: RawVbaModule[];
}

/** cfb のコンテナから、指定したストレージ配下を VbaStorage として扱う(root は "" や "_VBA_PROJECT_CUR") */
export function cfbStorage(container: CFB$Container, root = ""): VbaStorage {
  const byPath = new Map<string, Uint8Array>();
  container.FullPaths.forEach((full, i) => {
    const entry = container.FileIndex[i];
    if (entry.type !== 2 || !entry.content) return;
    // FullPaths は "Root Entry/VBA/dir" の形。先頭のルート名を除く
    const rel = full.split("/").slice(1).join("/").toUpperCase();
    byPath.set(rel, Uint8Array.from(entry.content as ArrayLike<number>));
  });
  const prefix = root ? `${root.toUpperCase()}/` : "";
  return { read: (path) => byPath.get(prefix + path.toUpperCase()) ?? null };
}

export function hasVbaProject(storage: VbaStorage): boolean {
  return storage.read("VBA/dir") !== null;
}

export function extractVbaProject(storage: VbaStorage, warnings: string[]): RawVbaProject | null {
  const dirRaw = storage.read("VBA/dir");
  if (!dirRaw) return null;
  const dir = parseDirStream(decompressContainer(dirRaw));
  const encoding = encodingForCodePage(dir.codePage);
  if (!encoding) {
    warnings.push(`VBAのコードページ ${dir.codePage} に未対応のため cp1252 として読みました(文字化けの可能性があります)`);
  }

  const projectRaw = storage.read("PROJECT");
  const project = projectRaw
    ? parseProjectStream(projectRaw, dir.codePage)
    : { moduleKinds: new Map(), lockedForViewing: null, hasPassword: null };

  const modules: RawVbaModule[] = [];
  for (const m of dir.modules) {
    const stream = storage.read(`VBA/${m.streamName}`);
    let text = "";
    if (!stream) {
      warnings.push(`モジュール「${m.name}」のストリームが見つかりません`);
    } else if (m.offset >= stream.length) {
      warnings.push(`モジュール「${m.name}」のソース位置が不正です`);
    } else {
      try {
        text = decodeText(decompressContainer(stream, m.offset), dir.codePage);
      } catch (e) {
        warnings.push(`モジュール「${m.name}」のソースを解凍できませんでした: ${(e as Error).message}`);
      }
    }
    const { source, attributes } = stripAttributes(text);
    modules.push({
      name: m.name,
      streamName: m.streamName,
      type: moduleType(m.name, m.procedural, project.moduleKinds.get(m.name.toLowerCase()), attributes),
      source,
      attributes,
    });
  }

  return {
    name: dir.projectName,
    codePage: dir.codePage,
    encoding: encoding ?? "cp1252",
    lockedForViewing: project.lockedForViewing,
    hasPassword: project.hasPassword,
    references: dir.references.map(toReference),
    modules,
  };
}

function stripAttributes(text: string) {
  const attributes: Record<string, string> = {};
  const lines = text.replace(/\0+$/, "").split(/\r\n|\r|\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const m = /^Attribute\s+([\p{L}\p{N}_.]+)\s*=\s*(.*)$/iu.exec(line);
    if (m) {
      if (!m[1].includes(".")) attributes[m[1]] = m[2].replace(/^"|"$/g, "");
      continue;
    }
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  return { source: kept.join("\n"), attributes };
}

const DOCUMENT_BASES = ["0{00020819-", "0{00020820-", "0{00020821-"]; // Workbook / Worksheet / Chart

function moduleType(
  name: string,
  procedural: boolean,
  declared: string | undefined,
  attributes: Record<string, string>,
): ModuleType {
  if (/^Form_/i.test(name) && declared !== "standard") return "form";
  if (/^Report_/i.test(name) && declared !== "standard") return "report";
  if (declared === "standard") return "standard";
  if (declared === "class") return "class";
  if (declared === "document") return "document";
  if (declared === "designer") return "form";
  if (procedural) return "standard";
  const base = (attributes.VB_Base ?? "").toUpperCase();
  if (DOCUMENT_BASES.some((b) => base.startsWith(b))) return "document";
  if (base.startsWith("0{")) return "form";
  if (attributes.VB_Base !== undefined || attributes.VB_Creatable !== undefined) return "class";
  return "unknown";
}

function toReference(ref: DirReference): VbaReference {
  if (ref.kind === "project") {
    return {
      name: ref.name,
      kind: ref.kind,
      libid: ref.libid,
      description: null,
      path: ref.libid.replace(/^\*\\[A-Z]/, "") || null,
    };
  }
  const parts = ref.libid.split("#");
  return {
    name: ref.name,
    kind: ref.kind,
    libid: ref.libid,
    description: parts[4]?.trim() || null,
    path: parts[3]?.trim() || null,
  };
}
