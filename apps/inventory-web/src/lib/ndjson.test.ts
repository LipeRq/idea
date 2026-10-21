import { describe, expect, it } from "vitest";
import { NdjsonParser } from "./ndjson";

describe("NdjsonParser", () => {
  it("行の途中で分割されて届いても、最後に改行が無くても読む。JSON でない行は ok: false", () => {
    const p = new NdjsonParser();
    expect(p.push('{"type":"acc')).toEqual([]);
    expect(p.push('epted","batches":1}\n{"type":"heartbeat"}\nnot json\n{"type":"do')).toEqual([
      { ok: true, value: { type: "accepted", batches: 1 } },
      { ok: true, value: { type: "heartbeat" } },
      { ok: false, line: "not json" },
    ]);
    expect(p.push('ne"}')).toEqual([]);
    expect(p.end()).toEqual([{ ok: true, value: { type: "done" } }]);
    expect(p.end()).toEqual([]);
  });
});
