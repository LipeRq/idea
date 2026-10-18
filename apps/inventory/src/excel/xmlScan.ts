// 大きくなりうる XML(シート・描画・VML)を DOM にせずに走査するための、線形時間で終わる小さなスキャナ。
// `<tag[^>]*>([\s\S]*?)</tag>` のような正規表現は、閉じタグや ">" が無い壊れた入力で開始位置ごとに末尾まで探し直すため
// 入力の2乗の時間がかかる。ここでは開始タグを1回の走査で探し、閉じタグは indexOf で探して見つかった位置から再開する。

export interface XmlElement {
  /** 名前空間の接頭辞(":" を含む。無ければ "") */
  prefix: string;
  name: string;
  /** 開始タグの属性部分(末尾の "/" を含む) */
  attrs: string;
  selfClosing: boolean;
  /** 開始タグの位置 */
  index: number;
  /** 要素の中身。自己終了タグ・閉じタグが見つからない場合は null */
  inner: string | null;
}

/**
 * 指定した名前の要素を順に返す。names は正規表現の選択肢("sp|pic" など)、prefix は接頭辞の正規表現。
 * withInner が true なら閉じタグまでの中身も返し、閉じタグの後ろから走査を再開する(入れ子の同名要素は扱わない)。
 */
export function* scanElements(
  xml: string,
  names: string,
  options: { prefix?: string; withInner?: boolean } = {},
): Generator<XmlElement> {
  const last = xml.lastIndexOf(">");
  if (last < 0) return;
  // 末尾の ">" より後ろに開始タグがあると、[^>]* が末尾まで読んで失敗するのを開始位置ごとに繰り返すため切り落とす
  const s = last + 1 === xml.length ? xml : xml.slice(0, last + 1);
  const re = new RegExp(`<(${options.prefix ?? "(?:[\\w.-]+:)?"})(${names})(?=[\\s/>])([^>]*)>`, "g");
  const noCloseFrom = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const [whole, prefix, name, attrs] = m;
    const openEnd = m.index + whole.length;
    const selfClosing = attrs.endsWith("/");
    if (selfClosing || !options.withInner) {
      yield { prefix, name, attrs, selfClosing, index: m.index, inner: null };
      continue;
    }
    const close = `</${prefix}${name}>`;
    let c = -1;
    if (openEnd < (noCloseFrom.get(close) ?? Infinity)) {
      c = s.indexOf(close, openEnd);
      // ここより後ろには閉じタグが無いので、以降の同名要素では探さない
      if (c < 0) noCloseFrom.set(close, openEnd);
    }
    if (c < 0) {
      yield { prefix, name, attrs, selfClosing, index: m.index, inner: null };
      continue;
    }
    yield { prefix, name, attrs, selfClosing, index: m.index, inner: s.slice(openEnd, c) };
    re.lastIndex = c + close.length;
  }
}

/** 最初に見つかった要素(無ければ null) */
export function firstElement(xml: string, names: string, options: { prefix?: string; withInner?: boolean } = {}): XmlElement | null {
  for (const el of scanElements(xml, names, options)) return el;
  return null;
}

/** <a:t>…</a:t> のような単純な要素の中身をすべて返す(線形時間) */
export function innerTexts(xml: string, open: string, close: string): string[] {
  const out: string[] = [];
  let pos = 0;
  for (;;) {
    const o = xml.indexOf(open, pos);
    if (o < 0) break;
    const c = xml.indexOf(close, o + open.length);
    if (c < 0) break;
    out.push(xml.slice(o + open.length, c));
    pos = c + close.length;
  }
  return out;
}
