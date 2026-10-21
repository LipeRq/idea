// 解析 Worker の入口(scripts/build-worker.mjs で1ファイルにまとめ、public/engine/ に置く)。
// ファイルのバイト列を読むのはこの Worker だけ。ここには通信のコードを置かない(lockdown で API も消す)。
import "./lockdown";
import { ENGINE_VERSION, handleRequest } from "./handle";
import { workerScope } from "./scope";

const scope = workerScope();
scope.addEventListener("message", (event) => {
  void handleRequest(event.data, (res) => scope.postMessage(res));
});
scope.postMessage({ type: "ready", engineVersion: ENGINE_VERSION });
