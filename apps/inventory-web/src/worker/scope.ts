// Worker のグローバル(self)の型。tsconfig は画面と共通で DOM の型を使うため、Worker で使う部分だけを局所的に型付けする。
import type { WorkerRequest, WorkerResponse } from "./protocol";

export interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: "message", listener: (event: { data: WorkerRequest }) => void): void;
  addEventListener(type: "securitypolicyviolation", listener: (event: { violatedDirective: string }) => void): void;
}

export const workerScope = (): WorkerScope => self as unknown as WorkerScope;
