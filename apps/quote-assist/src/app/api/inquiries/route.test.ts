import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_SCENARIOS } from "@/lib/demo/scenarios";
import { getDeps } from "@/lib/deps";
import { sampleFile, TEST_TODAY } from "@/lib/test-helpers";
import { POST as approve } from "./[id]/approve/route";
import { POST as registerCrm } from "./[id]/crm/route";
import { GET as getDrawing } from "./[id]/drawings/[drawingId]/route";
import { POST as estimate } from "./[id]/estimate/route";
import { PATCH as patchExtraction } from "./[id]/extraction/route";
import { PUT as putQuote } from "./[id]/quote/route";
import { POST } from "./route";

// 実際のAPIは呼ばない(呼ばれたら失敗させる)
const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { stream: streamMock } };
  },
}));

const scenario = DEMO_SCENARIOS[0];

function form(files: { name: string; data: Uint8Array }[], body = scenario.buildEmail(TEST_TODAY).body) {
  const f = new FormData();
  const email = scenario.buildEmail(TEST_TODAY);
  f.set("from", email.from);
  f.set("subject", email.subject);
  f.set("body", body);
  for (const file of files) f.append("files", new Blob([new Uint8Array(file.data)], { type: "application/pdf" }), file.name);
  return f;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown) =>
  new Request("http://localhost/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function create(): Promise<string> {
  const res = await POST(new Request("http://localhost/api/inquiries", { method: "POST", body: form(scenario.drawings.map((d) => sampleFile(d.fileName))) }));
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

beforeEach(() => {
  vi.stubEnv("STORAGE_DRIVER", "memory");
  vi.stubEnv("AI_PROVIDER", "demo");
  vi.stubEnv("CRM_PROVIDER", "mock");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  streamMock.mockImplementation(() => {
    throw new Error("AIは呼ばない");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/inquiries", () => {
  it("メール本文と図面PDFを受け付け、デモモードで読み取った引き合いを保存する", async () => {
    const id = await create();
    const inquiry = await getDeps().storage.inquiries.get(id);
    expect(inquiry?.extraction.mode).toBe("demo");
    expect(inquiry?.drawings).toHaveLength(2);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("PDFでないファイルは400", async () => {
    const res = await POST(
      new Request("http://localhost/api/inquiries", { method: "POST", body: form([{ name: "a.pdf", data: new TextEncoder().encode("hello") }]) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("PDFではない");
  });

  it("Content-Length が上限を超えていれば読まずに413", async () => {
    const res = await POST(
      new Request("http://localhost/api/inquiries", {
        method: "POST",
        headers: { "content-length": String(30 * 1024 * 1024) },
        body: "x",
      }),
    );
    expect(res.status).toBe(413);
  });

  it("フォームでない本文は400", async () => {
    const res = await POST(new Request("http://localhost/api/inquiries", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(400);
  });
});

describe("引き合いごとのAPI", () => {
  it("不正なidは404、存在しない引き合いも404", async () => {
    expect((await estimate(new Request("http://localhost"), ctx("../../etc"))).status).toBe(404);
    expect((await estimate(new Request("http://localhost"), ctx("00000000-0000-0000-0000-000000000000"))).status).toBe(404);
  });

  it("検索 → 見積の保存 → 承認 → CRM登録。承認前の登録は409", async () => {
    const id = await create();
    expect((await estimate(new Request("http://localhost"), ctx(id))).status).toBe(200);
    expect((await registerCrm(new Request("http://localhost"), ctx(id))).status).toBe(409);

    const inquiry = (await getDeps().storage.inquiries.get(id))!;
    const input = { ...inquiry.quote!.input, profitRate: 0.2 };
    expect((await putQuote(json(input), ctx(id))).status).toBe(200);
    expect((await putQuote(json({ ...input, quantity: -1 }), ctx(id))).status).toBe(400);

    expect((await approve(json({}), ctx(id))).status).toBe(400);
    expect((await approve(json({ approver: "工場長 森" }), ctx(id))).status).toBe(200);
    const res = await registerCrm(new Request("http://localhost"), ctx(id));
    expect(res.status).toBe(200);
    expect((await res.json()).crm.opportunityId).toMatch(/^006MK/);
  });

  it("抽出結果の修正は、定義した項目と値だけを受け付ける", async () => {
    const id = await create();
    const patch = (body: unknown) => patchExtraction(json(body), ctx(id));
    expect((await patch({ heatTreatment: "none" })).status).toBe(200);
    expect((await patch({ unknownField: 1 })).status).toBe(400);
    expect((await patch({ quantity: 0 })).status).toBe(400);
    expect((await patch({ surfaceTreatment: "induction_hardening" })).status).toBe(400);
  });

  it("図面PDFは private・no-store で返す", async () => {
    const id = await create();
    const res = await getDrawing(new Request("http://localhost"), { params: Promise.resolve({ id, drawingId: "1" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const missing = await getDrawing(new Request("http://localhost"), { params: Promise.resolve({ id, drawingId: "9" }) });
    expect(missing.status).toBe(404);
  });

  it("想定外のエラーは内容を返さず500", async () => {
    const id = await create();
    const deps = getDeps();
    vi.spyOn(deps.storage.inquiries, "get").mockRejectedValueOnce(new Error("disk path /secret"));
    const res = await estimate(new Request("http://localhost"), ctx(id));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("/secret");
  });
});
