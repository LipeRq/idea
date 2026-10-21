// 解析 Worker の管理。
// - 1つの Worker は1件の依頼だけを処理し、終わったら terminate() する(エンジンや mdb-reader が持つメモリを確実に解放する)。
// - 予備の Worker を1つ温めておき、依頼が来たらそれを使ってすぐ次の予備を作る(起動待ちをなくす)。
//   Worker のスクリプトは最初に1回だけ取得して Blob URL から起動するので、オフラインでも作り直せる(engine-loader.ts)。
// - 監視タイマー: 協調的な制限時間が届かない処理に備え、時間切れなら terminate() して失敗にする。
//   解析では Worker から phase: analyzing を受けた時点で数え始める(大きなファイルの読み込み時間を含めない)。
import type { AnalysisLimits, InventoryReport } from "@engine/browser";
import type { AiDocumentJson } from "./ai-json";
import type { Failure } from "./errors";
import type { AiPayload, AnalysisResult, Phase, RenderedDocument, WorkerRequest, WorkerResponse } from "@/worker/protocol";

/** Worker のうち、ここで使う部分(単体テストでは偽物を差し込む) */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: { preventDefault?: () => void }) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ControllerOptions {
  /** Worker を作る。スクリプトを取得できなければ例外(loadFailed になる) */
  createWorker: () => WorkerLike | Promise<WorkerLike>;
  /** 解析の監視タイマー(phase: analyzing から数える) */
  watchdogMs: number;
  /** ファイルを読まない依頼(仕様書の作り直し・送信内容の作成)の監視タイマー */
  renderWatchdogMs: number;
  /** Worker が ready を返すまでの待ち時間(超えたら loadFailed) */
  readyTimeoutMs?: number;
  timers?: Timers;
  onCspViolation?: (directive: string) => void;
}

/** 解析・依頼の失敗(画面は failure.code で文言を選ぶ) */
export class AnalysisFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.code);
  }
}

/** 利用者が中止した(エラーとしては表示しない) */
export class CancelledError extends Error {
  constructor() {
    super("cancelled");
  }
}

interface Slot {
  worker: WorkerLike | null;
  ready: Promise<void>;
  handler: ((res: WorkerResponse) => void) | null;
  crashed: ((failure: Failure) => void) | null;
  terminated: boolean;
}

interface Active {
  slot: Slot;
  cancel: () => void;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class AnalysisController {
  private spare: Slot | null = null;
  private active: Active | null = null;
  private nextId = 1;
  private disposed = false;
  private readonly timers: Timers;

  constructor(private readonly options: ControllerOptions) {
    this.timers = options.timers ?? defaultTimers;
  }

  /** 予備の Worker を用意し、起動を待つ(起動できなければ AnalysisFailure(loadFailed)) */
  async warmUp(): Promise<void> {
    this.spare ??= this.createSlot();
    try {
      await this.spare.ready;
    } catch (e) {
      // 失敗した予備は捨てる(次の依頼で作り直す)
      this.discard(this.spare);
      this.spare = null;
      throw e;
    }
  }

  get busy(): boolean {
    return this.active !== null;
  }

  analyze(file: File, limits: Partial<AnalysisLimits>, onPhase?: (phase: Phase) => void): Promise<AnalysisResult> {
    return this.run(
      (id) => ({ type: "analyze", id, file, limits }),
      (msg) => (msg.type === "analyzed" ? msg.result : undefined),
      { watchdogMs: this.options.watchdogMs, watchdogPhase: "analyzing", onPhase },
    );
  }

  render(report: InventoryReport, ai: AiDocumentJson): Promise<{ document: RenderedDocument; businessFlow: string | null }> {
    return this.run(
      (id) => ({ type: "render", id, report, ai }),
      (msg) => (msg.type === "rendered" ? { document: msg.document, businessFlow: msg.businessFlow } : undefined),
      { watchdogMs: this.options.renderWatchdogMs },
    );
  }

  buildAiPayload(report: InventoryReport, includeSource: boolean, consentVersion: string): Promise<AiPayload> {
    return this.run(
      (id) => ({ type: "aiPayload", id, report, includeSource, consentVersion }),
      (msg) => (msg.type === "aiPayload" ? msg.payload : undefined),
      { watchdogMs: this.options.renderWatchdogMs },
    );
  }

  /** 実行中の依頼を中止する(Worker を terminate() し、Promise は CancelledError で終わる) */
  cancel(): void {
    this.active?.cancel();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    if (this.spare) this.discard(this.spare);
    this.spare = null;
  }

  private createSlot(): Slot {
    const slot: Slot = { worker: null, ready: Promise.resolve(), handler: null, crashed: null, terminated: false };
    slot.ready = (async () => {
      let worker: WorkerLike;
      try {
        worker = await this.options.createWorker();
      } catch {
        throw new AnalysisFailure({ code: "loadFailed" });
      }
      if (slot.terminated) {
        worker.terminate();
        throw new CancelledError();
      }
      slot.worker = worker;
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        const timer = this.timers.setTimeout(() => {
          if (!ready) reject(new AnalysisFailure({ code: "loadFailed" }));
        }, this.options.readyTimeoutMs ?? 30_000);
        const fail = (failure: Failure) => {
          if (!ready) {
            this.timers.clearTimeout(timer);
            reject(new AnalysisFailure({ code: "loadFailed" }));
          } else {
            slot.crashed?.(failure);
          }
        };
        worker.onmessage = (event) => {
          const msg = event.data;
          if (msg.type === "csp") {
            this.options.onCspViolation?.(msg.directive);
            return;
          }
          if (msg.type === "ready") {
            ready = true;
            this.timers.clearTimeout(timer);
            resolve();
            return;
          }
          slot.handler?.(msg);
        };
        worker.onerror = (event) => {
          // 既定の処理(コンソールへの出力)はそのまま。起動前ならスクリプトの読み込み失敗、起動後なら異常終了
          event?.preventDefault?.();
          fail({ code: "crashed" });
        };
        worker.onmessageerror = () => fail({ code: "crashed" });
      });
    })();
    // 予備のまま失敗した場合に、未処理の rejection として扱われないようにする(使うときに await して扱う)
    slot.ready.catch(() => undefined);
    return slot;
  }

  private discard(slot: Slot) {
    slot.terminated = true;
    slot.handler = null;
    slot.crashed = null;
    slot.worker?.terminate();
  }

  private run<T>(
    build: (id: number) => WorkerRequest,
    accept: (msg: WorkerResponse) => T | undefined,
    opts: { watchdogMs: number; watchdogPhase?: Phase; onPhase?: (phase: Phase) => void },
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new CancelledError());
    if (this.active) return Promise.reject(new Error("別の解析を実行中です"));
    const slot = this.spare ?? this.createSlot();
    // すぐ次の予備を作る(この依頼の Worker は終わったら捨てる)
    this.spare = this.createSlot();
    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      let timer: unknown = null;
      let settled = false;
      const finish = (done: () => void) => {
        if (settled) return;
        settled = true;
        if (timer !== null) this.timers.clearTimeout(timer);
        this.discard(slot);
        if (this.active?.slot === slot) this.active = null;
        done();
      };
      const startWatchdog = () => {
        if (timer !== null) return;
        timer = this.timers.setTimeout(() => finish(() => reject(new AnalysisFailure({ code: "timeout" }))), opts.watchdogMs);
      };
      this.active = { slot, cancel: () => finish(() => reject(new CancelledError())) };

      slot.ready.then(
        () => {
          if (settled) return;
          slot.handler = (msg) => {
            if (!("id" in msg) || msg.id !== id) return;
            if (msg.type === "phase") {
              opts.onPhase?.(msg.phase);
              if (msg.phase === opts.watchdogPhase) startWatchdog();
              return;
            }
            if (msg.type === "error") {
              finish(() => reject(new AnalysisFailure(msg.error)));
              return;
            }
            const value = accept(msg);
            if (value !== undefined) finish(() => resolve(value));
          };
          slot.crashed = (failure) => finish(() => reject(new AnalysisFailure(failure)));
          if (!opts.watchdogPhase) startWatchdog();
          slot.worker!.postMessage(build(id));
        },
        (e: unknown) => finish(() => reject(e instanceof AnalysisFailure || e instanceof CancelledError ? e : new AnalysisFailure({ code: "loadFailed" }))),
      );
    });
  }
}
