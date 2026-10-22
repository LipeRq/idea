// 仕様書に入れる Mermaid の図の簡易な構文検査。Mermaid 本体のパーサーではなく、このツールが組み立てる形
// (flowchart / ID と形 / 引用符つきラベル / --> とラベル)に絞って、壊れていないかを確かめる。
// 目的は「ブラウザで図が描けず、エラー表示になる」ような崩れ(引用符・かっこの不一致、未定義のID、コードフェンスを閉じる文字)を見つけること。

export type MermaidIssue = { line: number; message: string };

const ID = String.raw`[A-Za-z][A-Za-z0-9_]*`;
const LABEL = String.raw`"[^"]*"`;
// ノードの形: [..] / (..) の組み合わせ(例: ([...]) [(...)] [[...]])
const SHAPE = String.raw`(?:\(\[${LABEL}\]\)|\[\(${LABEL}\)\]|\[\[${LABEL}\]\]|\[${LABEL}\]|\(${LABEL}\))`;
const NODE_REF = String.raw`(${ID})(${SHAPE})?`;
// 矢印のラベルは、引用符つき(|"..."|)と、ツールが付ける短い固定の語(|表示|)の両方がある
const EDGE = new RegExp(String.raw`^\s*${NODE_REF}\s*-->\s*(?:\|(?:${LABEL}|[^|"<>\n\`]{0,20})\|\s*)?${NODE_REF}\s*$`);
const NODE_ONLY = new RegExp(String.raw`^\s*${NODE_REF}\s*$`);

export function checkMermaid(code: string): MermaidIssue[] {
  const issues: MermaidIssue[] = [];
  const lines = code.split("\n");
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first < 0) return [{ line: 1, message: "図が空です" }];
  if (!/^\s*flowchart\s+(?:LR|RL|TD|TB|BT)\s*$/.test(lines[first])) issues.push({ line: first + 1, message: `先頭が flowchart の宣言ではありません: ${lines[first].trim().slice(0, 40)}` });

  const defined = new Set<string>();
  const used: { id: string; line: number }[] = [];
  let edges = 0;
  lines.forEach((raw, i) => {
    if (i <= first || raw.trim() === "") return;
    const n = i + 1;
    if (/```/.test(raw)) issues.push({ line: n, message: "コードフェンスを閉じる文字(```)が含まれています" });
    // ラベルの外に、構文を壊す文字が出ていないか(ラベル内の # は文字参照で、< > は無害化済みのはず)
    const outsideLabels = raw.replace(new RegExp(LABEL, "g"), '""');
    if ((raw.match(/"/g) ?? []).length % 2 !== 0) issues.push({ line: n, message: "引用符の数が奇数です" });
    for (const [open, close] of [["[", "]"], ["(", ")"]] as const) {
      if (outsideLabels.split(open).length !== outsideLabels.split(close).length) issues.push({ line: n, message: `${open}${close} の数が合いません` });
    }
    const labels = raw.match(new RegExp(LABEL, "g")) ?? [];
    for (const l of labels) {
      if (/[<>`]/.test(l)) issues.push({ line: n, message: `ラベルに < > ` + "`" + ` が残っています: ${l.slice(0, 30)}` });
      if (/\r|\t/.test(l)) issues.push({ line: n, message: "ラベルに改行・タブがあります" });
      if (/#(?!(?:\d+|quot|lt|gt|amp);)/.test(l)) issues.push({ line: n, message: `ラベルの # が文字参照になっていません: ${l.slice(0, 30)}` });
    }
    const edge = EDGE.exec(raw);
    if (edge) {
      edges++;
      for (const [id, shape] of [[edge[1], edge[2]], [edge[3], edge[4]]] as const) {
        if (shape) defined.add(id);
        else used.push({ id, line: n });
      }
      return;
    }
    const node = NODE_ONLY.exec(raw);
    if (node && node[2]) {
      defined.add(node[1]);
      return;
    }
    issues.push({ line: n, message: `解釈できない行です: ${raw.trim().slice(0, 60)}` });
  });
  for (const u of used) if (!defined.has(u.id)) issues.push({ line: u.line, message: `定義されていないノードを使っています: ${u.id}` });
  if (defined.size === 0 && edges === 0) issues.push({ line: first + 1, message: "ノードがありません" });
  return issues;
}

/** Markdown から ```mermaid ブロックを取り出す */
export function extractMermaidBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => m[1]);
}
