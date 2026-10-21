import { describe, expect, it, vi } from "vitest";
import type { WorkerRequest, WorkerResponse } from "@/worker/protocol";
import { AnalysisController, AnalysisFailure, CancelledError, type Timers, type WorkerLike } from "./analysis-controller";

/** 偽の Worker。postMessage された依頼を記録し、テストから応答を返す */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: ((event: { preventDefault?: () => void }) => void) | null = null;
  onmessageerror: ((event: unknown) => void) | null = null;
  requests: WorkerRequest[] = [];
  terminated = false;
  postMessage(message: WorkerRequest) {
    this.requests.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  send(data: WorkerResponse) {
    this.onmessage?.({ data });
  }
  ready() {
    this.send({ type: "ready", engineVersion: "test" });
  }
}

/** setTimeout を手で進めるタイマー */
class ManualTimers implements Timers {
  private next = 1;
  pending = new Map<number, { fn: () => void; ms: number }>();
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.pending.set(id, { fn, ms });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  fire(ms: number) {
    for (const [id, t] of [...this.pending]) {
      if (t.ms === ms) {
        this.pending.delete(id);
        t.fn();
      }
    }
  }
}

const file = { name: "a.xlsm", size: 10 } as File;
const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(overrides: { createWorker?: () => WorkerLike | Promise<WorkerLike> } = {}) {
  const workers: FakeWorker[] = [];
  const timers = new ManualTimers();
  const createWorker =
    overrides.createWorker ??
    (() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
  const controller = new AnalysisController({ createWorker, watchdogMs: 75_000, renderWatchdogMs: 60_000, readyTimeoutMs: 30_000, timers });
  return { controller, workers, timers };
}

describe("AnalysisController", () => {
  it("予備の Worker を使って解析し、終わったら terminate して次の予備を用意する", async () => {
    const { controller, workers } = setup();
    const warm = controller.warmUp();
    await flush();
    workers[0].ready();
    await warm;
    expect(workers).toHaveLength(1);

    const phases: string[] = [];
    const promise = controller.analyze(file, {}, (p) => phases.push(p));
    await flush();
    expect(workers).toHaveLength(2); // 次の予備
    const req = workers[0].requests[0];
    expect(req.type).toBe("analyze");
    workers[0].send({ type: "phase", id: req.id, phase: "analyzing" });
    workers[0].send({ type: "analyzed", id: req.id, result: { ok: true } as never });
    await expect(promise).resolves.toEqual({ ok: true });
    expect(phases).toEqual(["analyzing"]);
    expect(workers[0].terminated).toBe(true);
    expect(workers[1].terminated).toBe(false);
    expect(controller.busy).toBe(false);
  });

  it("Worker のエラー応答は AnalysisFailure(コード付き)になる", async () => {
    const { controller, workers } = setup();
    const promise = controller.analyze(file, {});
    await flush();
    workers[0].ready();
    await flush();
    const req = workers[0].requests[0];
    workers[0].send({ type: "error", id: req.id, error: { code: "corrupt", message: "壊れています" } });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnalysisFailure);
    expect((error as AnalysisFailure).failure).toEqual({ code: "corrupt", message: "壊れています" });
    expect(workers[0].terminated).toBe(true);
  });

  it("中止すると Worker を terminate し、CancelledError で終わる", async () => {
    const { controller, workers } = setup();
    const promise = controller.analyze(file, {});
    await flush();
    workers[0].ready();
    await flush();
    controller.cancel();
    await expect(promise).rejects.toBeInstanceOf(CancelledError);
    expect(workers[0].terminated).toBe(true);
    expect(controller.busy).toBe(false);
  });

  it("監視タイマーは analyzing を受けてから数え、時間切れなら terminate して timeout にする", async () => {
    const { controller, workers, timers } = setup();
    const promise = controller.analyze(file, {});
    await flush();
    workers[0].ready();
    await flush();
    // 読み込み中(reading)はまだ数えない
    workers[0].send({ type: "phase", id: workers[0].requests[0].id, phase: "reading" });
    expect([...timers.pending.values()].some((t) => t.ms === 75_000)).toBe(false);
    workers[0].send({ type: "phase", id: workers[0].requests[0].id, phase: "analyzing" });
    timers.fire(75_000);
    await expect(promise).rejects.toMatchObject({ failure: { code: "timeout" } });
    expect(workers[0].terminated).toBe(true);
  });

  it("起動前の Worker のエラーは loadFailed(スクリプトを読めない)、起動後のエラーは crashed", async () => {
    const { controller, workers } = setup();
    const first = controller.analyze(file, {});
    await flush();
    workers[0].onerror?.({ preventDefault: vi.fn() });
    await expect(first).rejects.toMatchObject({ failure: { code: "loadFailed" } });

    const second = controller.analyze(file, {});
    await flush();
    const w = workers[1];
    w.ready();
    await flush();
    w.onerror?.({});
    await expect(second).rejects.toMatchObject({ failure: { code: "crashed" } });
    expect(w.terminated).toBe(true);
  });

  it("Worker を作れない(スクリプトの取得に失敗)ときは loadFailed", async () => {
    const { controller } = setup({ createWorker: () => Promise.reject(new Error("offline")) });
    await expect(controller.warmUp()).rejects.toMatchObject({ failure: { code: "loadFailed" } });
    await expect(controller.analyze(file, {})).rejects.toMatchObject({ failure: { code: "loadFailed" } });
  });

  it("CSP の違反の知らせは依頼とは別に受け取る", async () => {
    const onCsp = vi.fn();
    const workers: FakeWorker[] = [];
    const controller = new AnalysisController({
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
      watchdogMs: 1000,
      renderWatchdogMs: 1000,
      timers: new ManualTimers(),
      onCspViolation: onCsp,
    });
    const warm = controller.warmUp();
    await flush();
    workers[0].ready();
    await warm;
    workers[0].send({ type: "csp", directive: "script-src" });
    expect(onCsp).toHaveBeenCalledWith("script-src");
  });

  it("実行中に別の依頼は受け付けない", async () => {
    const { controller } = setup();
    void controller.analyze(file, {}).catch(() => undefined);
    await expect(controller.analyze(file, {})).rejects.toThrow("別の解析を実行中です");
    controller.dispose();
  });
});
