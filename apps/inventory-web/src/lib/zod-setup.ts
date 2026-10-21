import { z } from "zod";

// zod は z.object() を作るときに new Function で eval が使えるかを試し、使えれば高速化に使う。
// ブラウザでは CSP で eval を禁止しているので、試すだけで違反の報告(コンソールのエラー)が出る。
// スキーマを作る前に読み込み、eval を使わないようにする(入力が小さいので速度の差はない)。
// (apps/diagnosis の src/lib/zod-setup.ts と同じ。Worker 側はエンジンの zod に対して src/worker/lockdown.ts で同じ設定をする)
z.config({ jitless: true });
