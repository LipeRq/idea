// NDJSON(1行1つの JSON)のストリームを読む。行が途中で分割されて届く・最後の行に改行が無い・
// JSON として読めない行がある、のいずれでも例外を出さずに扱う。

export type NdjsonItem = { ok: true; value: unknown } | { ok: false; line: string };

export class NdjsonParser {
  private buffer = "";

  /** 受け取った文字列を足し、完成した行を返す */
  push(chunk: string): NdjsonItem[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.flatMap((line) => parseLine(line));
  }

  /** ストリームの終わり。改行で終わっていない最後の行を返す */
  end(): NdjsonItem[] {
    const rest = this.buffer;
    this.buffer = "";
    return parseLine(rest);
  }
}

function parseLine(raw: string): NdjsonItem[] {
  const line = raw.trim();
  if (!line) return [];
  try {
    return [{ ok: true, value: JSON.parse(line) }];
  } catch {
    return [{ ok: false, line: line.slice(0, 200) }];
  }
}
