// AI 版の送信内容に含まれる、注意が必要な文字列を探す(送信前に場所付きで利用者に見せるため)。
// エンジンの伏せ字はパスワードのパターンだけを対象にしており、APIキー・トークン・Webhook の URL、
// コードやコメントに書かれた氏名・メールアドレス・電話番号は伏せられずにそのまま送られる。
// ここでの検出も完全ではない(見つけたものを示すだけ)。誤検出も含めて「確認のきっかけ」として表示する。
import type { InventoryReport } from "@engine/browser";

export type SensitiveKind = "email" | "phone" | "webhook" | "urlSecret" | "secretKeyword" | "randomString" | "userFolder";

export const SENSITIVE_KIND_LABEL: Record<SensitiveKind, string> = {
  email: "メールアドレス",
  phone: "電話番号",
  webhook: "通知・連携用のURL(Webhook など)",
  urlSecret: "キーやトークンを含むURL",
  secretKeyword: "APIキー・トークン・認証情報の可能性",
  randomString: "長いランダムな文字列(キーの可能性)",
  userFolder: "個人のフォルダのパス(氏名を含む可能性)",
};

export interface SensitiveHit {
  kind: SensitiveKind;
  label: string;
  /** 見つかった場所(モジュール名と行など) */
  location: string;
  /** 見つかった文字列 */
  match: string;
  /** 前後を含む抜粋(1行・最大120文字) */
  excerpt: string;
}

export const MAX_SENSITIVE_HITS = 300;

interface Pattern {
  kind: SensitiveKind;
  re: RegExp;
  accept?: (match: string, line: string) => boolean;
}

const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const PATTERNS: Pattern[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  { kind: "phone", re: /(?<![\d-])(?:0\d{1,4}-\d{1,4}-\d{3,4}|0[789]0\d{8}|\+81[- ]?\d{1,4}-\d{1,4}-\d{3,4})(?![\d-])/g },
  {
    kind: "webhook",
    re: /https?:\/\/(?:hooks\.slack\.com|discord(?:app)?\.com\/api\/webhooks|notify-api\.line\.me|api\.line\.me|api\.chatwork\.com|outlook\.office(?:365)?\.com\/webhook|[\w.-]*webhook[\w.-]*|[\w.-]+\.logic\.azure\.com)[^\s"'<>]*/gi,
  },
  {
    kind: "urlSecret",
    re: /https?:\/\/[^\s"'<>]*[?&](?:api[_-]?key|apikey|key|token|access[_-]?token|secret|sig|signature|code|auth)=[^\s"'&<>]+/gi,
  },
  {
    kind: "secretKeyword",
    re: /(?<![A-Za-z])(?:api[_-]?key|apikey|access[_-]?key|secret|client[_-]?secret|token|bearer|authorization|x-api-key|webhook|send(?:password|username)|smtpauthenticate)(?![A-Za-z])/gi,
    // 名前だけの言及(コメントの説明文など)でも出すが、値の代入・引数・文字列のある行に絞る
    accept: (_m, line) => /[="':(,]/.test(line),
  },
  {
    kind: "randomString",
    re: /(?<![A-Za-z0-9_+/=-])[A-Za-z0-9_+/=-]{32,}(?![A-Za-z0-9_+/=-])/g,
    accept: (m) => /[A-Za-z]/.test(m) && /\d/.test(m) && !GUID.test(m) && entropy(m) >= 3.2,
  },
  { kind: "userFolder", re: /[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\"'\s<>]+/gi },
];

function excerptOf(line: string, index: number, length: number): string {
  const flat = line.replace(/\s+/g, " ").trim();
  if (flat.length <= 120) return flat;
  const start = Math.max(0, Math.min(index - 40, line.length - 120));
  const cut = line.slice(start, start + Math.max(120, length + 20)).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${cut}${start + 120 < line.length ? "…" : ""}`;
}

/** 送信される抽出結果(伏せ字・項目の除外を済ませたもの)を走査する */
export function scanSensitive(report: InventoryReport, max = MAX_SENSITIVE_HITS): { total: number; hits: SensitiveHit[] } {
  const hits: SensitiveHit[] = [];
  const seen = new Set<string>();
  let total = 0;

  const scanText = (text: string | null | undefined, location: (lineNo: number) => string) => {
    if (!text) return;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        for (let m = p.re.exec(line); m; m = p.re.exec(line)) {
          const found = m[0];
          if (p.accept && !p.accept(found, line)) continue;
          const where = location(i + 1);
          const key = `${p.kind}\u0000${found.toLowerCase()}\u0000${where}`;
          if (seen.has(key)) continue;
          seen.add(key);
          total++;
          if (hits.length < max) {
            hits.push({ kind: p.kind, label: SENSITIVE_KIND_LABEL[p.kind], location: where, match: found, excerpt: excerptOf(line, m.index, found.length) });
          }
        }
      }
    });
  };

  for (const m of report.vba?.modules ?? []) scanText(m.source, (line) => `${m.name} ${line}行目`);
  for (const ref of report.vba?.references ?? []) scanText(ref.path, () => `参照設定「${ref.name}」`);
  for (const d of report.dependencies) {
    const l = d.location;
    scanText(d.target, () => (l.module ? `${l.module}${l.line ? ` ${l.line}行目` : ""}` : (l.part ?? "外部依存")));
  }
  const x = report.excel;
  if (x) {
    for (const s of x.sheets) {
      for (const f of s.formulaSamples) scanText(f.formula, () => `シート「${s.name}」${f.cell ? `の ${f.cell}` : ""}の数式`);
    }
    for (const n of x.definedNames) scanText(n.refersTo, () => `名前定義「${n.name}」`);
    for (const l of x.externalLinks) scanText(l.target, () => "外部リンク");
    for (const c of x.connections) {
      scanText(c.connectionString, () => `データ接続「${c.name}」`);
      scanText(c.command, () => `データ接続「${c.name}」`);
    }
  }
  const a = report.access;
  if (a) {
    for (const q of a.queries) {
      scanText(q.sql, (line) => `クエリ「${q.name}」 ${line}行目`);
      scanText(q.connect, () => `クエリ「${q.name}」の接続文字列`);
    }
    for (const t of a.linkedTables) {
      scanText(t.connect, () => `リンクテーブル「${t.name}」`);
      scanText(t.database, () => `リンクテーブル「${t.name}」`);
    }
  }
  return { total, hits };
}
