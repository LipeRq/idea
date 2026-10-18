// OOXML 系(.xlsm / .xlsb)で共通の部品: 文書プロパティ、ボタン等に登録されたマクロ、外部リンク。
import type { ControlMacro, ExternalLink, Properties } from "../schema";
import { maskSecrets } from "../secrets";
import { decodeXmlText, nodeText, type OpcPackage } from "./opc";
import { firstElement, innerTexts, scanElements } from "./xmlScan";

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
  const found = new Map<string, ControlMacro>();
  const add = (control: string, text: string | null, macro: string) => {
    const name = normalizeMacroName(decodeXmlText(macro));
    if (!name) return;
    const existing = found.get(name);
    if (existing) {
      existing.text ??= text;
      return;
    }
    if (found.size < pkg.budget.limits.maxListItems) found.set(name, { sheet: sheetName, control, text, macro: name });
  };

  if (sheetXml) {
    for (const el of scanElements(sheetXml, "control", { withInner: true })) {
      pkg.budget.check();
      const pr = el.inner ? firstElement(el.inner, "controlPr") : null;
      const macro = pr ? attr(pr.attrs, "macro") : null;
      if (macro) add(attr(el.attrs, "name") ?? "コントロール", pr ? attr(pr.attrs, "altText") : null, macro);
    }
  }

  for (const rel of pkg.rels(sheetPath)) {
    if (rel.external) continue;
    if (rel.type === "drawing") {
      const xml = pkg.text(rel.target);
      if (!xml) continue;
      for (const el of scanElements(xml, "sp|pic|graphicFrame|cxnSp", { prefix: "(?:xdr:)?", withInner: true })) {
        pkg.budget.check();
        const macro = attr(el.attrs, "macro");
        if (!macro || el.inner === null) continue;
        const cNvPr = firstElement(el.inner, "cNvPr", { prefix: "(?:xdr:)?" });
        const name = cNvPr ? attr(cNvPr.attrs, "name") : null;
        const text = innerTexts(el.inner, "<a:t>", "</a:t>").map(decodeXmlText).join("").trim();
        add(name ?? "図形", text || null, macro);
      }
    } else if (rel.type === "vmlDrawing") {
      const xml = pkg.text(rel.target);
      if (!xml) continue;
      for (const el of scanElements(xml, "shape", { prefix: "v:", withInner: true })) {
        pkg.budget.check();
        if (el.inner === null) continue;
        const macro = innerTexts(el.inner, "<x:FmlaMacro>", "</x:FmlaMacro>")[0];
        if (!macro) continue;
        const data = firstElement(el.inner, "ClientData", { prefix: "x:" });
        const type = (data ? attr(data.attrs, "ObjectType") : null) ?? "コントロール";
        const box = firstElement(el.inner, "textbox", { prefix: "v:", withInner: true })?.inner;
        add(type, box ? stripTags(box) : null, macro);
      }
    }
  }
  return [...found.values()];
}

/** 外部リンク(xl/externalLinks/externalLinkN.xml)の参照先 */
export function readExternalLink(pkg: OpcPackage, partPath: string, index: number): ExternalLink {
  const rels = pkg.rels(partPath);
  const xml = pkg.text(partPath) ?? "";
  const target = (id: string | null) => {
    const r = rels.find((x) => x.id === id) ?? rels[0];
    return r ? maskSecrets(decodeTarget(r.target)) : "(不明)";
  };
  const book = firstElement(xml, "externalBook");
  if (book) {
    const sheetNames: string[] = [];
    for (const el of scanElements(xml, "sheetName")) {
      const v = attr(el.attrs, "val");
      if (v !== null && sheetNames.length < pkg.budget.limits.maxListItems) sheetNames.push(v);
    }
    return { index, type: "workbook", target: target(attr(book.attrs, "r:id")), sheetNames };
  }
  const dde = firstElement(xml, "ddeLink");
  if (dde) {
    return {
      index,
      type: "dde",
      target: `${attr(dde.attrs, "ddeService") ?? ""}|${attr(dde.attrs, "ddeTopic") ?? ""}`,
      sheetNames: [],
    };
  }
  const ole = firstElement(xml, "oleLink");
  if (ole) {
    return { index, type: "ole", target: target(attr(ole.attrs, "r:id")), sheetNames: [] };
  }
  return { index, type: rels.length > 0 ? "workbook" : "unknown", target: rels[0] ? maskSecrets(decodeTarget(rels[0].target)) : "(不明)", sheetNames: [] };
}

function decodeTarget(t: string): string {
  try {
    return decodeURI(t);
  } catch {
    return t;
  }
}

export function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name.replace(/[.:]/g, "\\$&")}=(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeXmlText(m[1] ?? m[2]) : null;
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
