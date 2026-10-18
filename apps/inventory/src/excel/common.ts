// OOXML 系(.xlsm / .xlsb)で共通の部品: 文書プロパティ、ボタン等に登録されたマクロ、外部リンク。
import type { ControlMacro, ExternalLink, Properties } from "../schema";
import { decodeXmlText, nodeText, type OpcPackage } from "./opc";

export const EMPTY_PROPERTIES: Properties = {
  title: null,
  creator: null,
  lastModifiedBy: null,
  created: null,
  modified: null,
  application: null,
  appVersion: null,
  company: null,
};

export function readProperties(pkg: OpcPackage): Properties {
  const rootRels = pkg.rels("");
  const corePath = rootRels.find((r) => r.type === "core-properties")?.target ?? "docProps/core.xml";
  const appPath = rootRels.find((r) => r.type === "extended-properties")?.target ?? "docProps/app.xml";
  const core = pkg.xml(corePath)?.coreProperties ?? {};
  const app = pkg.xml(appPath)?.Properties ?? {};
  const str = (v: unknown) => {
    const t = nodeText(v)?.trim();
    return t ? t : null;
  };
  return {
    title: str(core.title),
    creator: str(core.creator),
    lastModifiedBy: str(core.lastModifiedBy),
    created: str(core.created),
    modified: str(core.modified),
    application: str(app.Application),
    appVersion: str(app.AppVersion),
    company: str(app.Company),
  };
}

/** "[0]!Module1.Macro" や "'Book1.xlsm'!Macro" からブック指定を取り除く */
export function normalizeMacroName(macro: string): string {
  return macro.replace(/^(?:\[\d+\]|'[^']*'|[^!'"]*)!/, "").trim();
}

/** シートに関連付いた描画(図形・フォームコントロール)から登録マクロを集める */
export function collectControlMacros(pkg: OpcPackage, sheetPath: string, sheetName: string, sheetXml: string | null): ControlMacro[] {
  const found: ControlMacro[] = [];
  const add = (control: string, text: string | null, macro: string) => {
    const name = normalizeMacroName(decodeXmlText(macro));
    if (!name) return;
    const existing = found.find((f) => f.macro === name);
    if (existing) {
      existing.text ??= text;
      return;
    }
    found.push({ sheet: sheetName, control, text, macro: name });
  };

  if (sheetXml) {
    for (const m of sheetXml.matchAll(/<control\b([^>]*)>([\s\S]*?)<\/control>/g)) {
      const macro = /\bmacro="([^"]+)"/.exec(m[2])?.[1];
      if (macro) add(attr(m[1], "name") ?? "コントロール", attr(m[2], "altText"), macro);
    }
  }

  for (const rel of pkg.rels(sheetPath)) {
    if (rel.external) continue;
    if (rel.type === "drawing") {
      const xml = pkg.text(rel.target);
      if (!xml) continue;
      for (const m of xml.matchAll(/<(?:xdr:)?(sp|pic|graphicFrame|cxnSp)\b([^>]*)>([\s\S]*?)<\/(?:xdr:)?\1>/g)) {
        const macro = attr(m[2], "macro");
        if (!macro) continue;
        const name = /<(?:xdr:)?cNvPr\b[^>]*\bname="([^"]*)"/.exec(m[3])?.[1];
        add(name ? decodeXmlText(name) : "図形", textOf(m[3], /<a:t>([\s\S]*?)<\/a:t>/g), macro);
      }
    } else if (rel.type === "vmlDrawing") {
      const xml = pkg.text(rel.target);
      if (!xml) continue;
      for (const m of xml.matchAll(/<v:shape\b([^>]*)>([\s\S]*?)<\/v:shape>/g)) {
        const macro = /<x:FmlaMacro>([\s\S]*?)<\/x:FmlaMacro>/.exec(m[2])?.[1];
        if (!macro) continue;
        const type = /ObjectType="([^"]+)"/.exec(m[2])?.[1] ?? "コントロール";
        const box = /<v:textbox\b[^>]*>([\s\S]*?)<\/v:textbox>/.exec(m[2])?.[1];
        add(type, box ? stripTags(box) : null, macro);
      }
    }
  }
  return found;
}

/** 外部リンク(xl/externalLinks/externalLinkN.xml)の参照先 */
export function readExternalLink(pkg: OpcPackage, partPath: string, index: number): ExternalLink {
  const rels = pkg.rels(partPath);
  const xml = pkg.text(partPath) ?? "";
  const target = (id: string | undefined) => {
    const r = rels.find((x) => x.id === id) ?? rels[0];
    return r ? decodeTarget(r.target) : "(不明)";
  };
  const book = /<externalBook\b([^>]*)>/.exec(xml);
  if (book) {
    const sheetNames = [...xml.matchAll(/<sheetName\b[^>]*\bval="([^"]*)"/g)].map((m) => decodeXmlText(m[1]));
    return { index, type: "workbook", target: target(attr(book[1], "r:id") ?? undefined), sheetNames };
  }
  const dde = /<ddeLink\b([^>]*)>/.exec(xml);
  if (dde) {
    return {
      index,
      type: "dde",
      target: `${attr(dde[1], "ddeService") ?? ""}|${attr(dde[1], "ddeTopic") ?? ""}`,
      sheetNames: [],
    };
  }
  const ole = /<oleLink\b([^>]*)>/.exec(xml);
  if (ole) {
    return { index, type: "ole", target: target(attr(ole[1], "r:id") ?? undefined), sheetNames: [] };
  }
  return { index, type: rels.length > 0 ? "workbook" : "unknown", target: rels[0] ? decodeTarget(rels[0].target) : "(不明)", sheetNames: [] };
}

function decodeTarget(t: string): string {
  try {
    return decodeURI(t);
  } catch {
    return t;
  }
}

export function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, "\\$&")}="([^"]*)"`).exec(attrs);
  return m ? decodeXmlText(m[1]) : null;
}

function textOf(xml: string, re: RegExp): string | null {
  const t = [...xml.matchAll(re)].map((m) => decodeXmlText(m[1])).join("").trim();
  return t || null;
}

function stripTags(s: string): string | null {
  const t = decodeXmlText(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  return t || null;
}

/** 0始まりの列番号を A, B, ..., AA 形式に変換する */
export function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function rangeRef(firstRow: number, lastRow: number, firstCol: number, lastCol: number): string | null {
  if (lastRow < firstRow || lastCol < firstCol) return null;
  const a = `${columnName(firstCol)}${firstRow + 1}`;
  const b = `${columnName(lastCol)}${lastRow + 1}`;
  return a === b ? a : `${a}:${b}`;
}
