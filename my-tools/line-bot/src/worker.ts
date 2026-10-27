// Cloudflare Workers の入口。
//   fetch:LINE の Webhook(https://line-bot.<サブドメイン>.workers.dev/webhook)を受け、自分のイベントをキューに入れる
//   queue:キューからイベントを取り出し、メモを整理して LINE に返す(キューの処理は応答の時間に縛られない)
import type { webhook } from "@line/bot-sdk";
import { createDeepSeekClient } from "./ai";
import { createLineApi } from "./line/api";
import { organizeMeetingNotes } from "./meeting/notes";
import { handleWebhook, processEvent, readWebhookConfig, type Logger, type WebhookEnv } from "./webhook/handler";

// Workers の型は使う部分だけを書く(@cloudflare/workers-types は Node.js の型とぶつかるので入れない)
interface Queue<T> {
  send(body: T): Promise<void>;
}
interface QueueMessage<T> {
  readonly body: T;
  ack(): void;
}
interface MessageBatch<T> {
  readonly messages: readonly QueueMessage<T>[];
}

export interface Env extends WebhookEnv {
  DEEPSEEK_API_KEY?: string;
  /** wrangler.jsonc の queues.producers */
  MEMO_QUEUE: Queue<webhook.Event>;
}

const log: Logger = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/webhook") return new Response("Not Found", { status: 404 });
    const result = readWebhookConfig(env);
    if (!result.ok) {
      log("config_missing", { names: result.missing.join(",") });
      return new Response("Server Not Configured", { status: 500 });
    }
    return handleWebhook(request, { config: result.config, dispatch: (event) => env.MEMO_QUEUE.send(event), log });
  },

  async queue(batch: MessageBatch<webhook.Event>, env: Env): Promise<void> {
    const result = readWebhookConfig(env);
    const ai = env.DEEPSEEK_API_KEY ? createDeepSeekClient(env.DEEPSEEK_API_KEY) : null;
    for (const message of batch.messages) {
      if (!result.ok) {
        log("config_missing", { names: result.missing.join(",") });
      } else {
        try {
          await processEvent(message.body, {
            config: result.config,
            line: createLineApi(result.config.channelAccessToken),
            organize: ai ? (input) => organizeMeetingNotes(input, ai, new Date()) : null,
            log,
          });
        } catch (e) {
          log("event_failed", { type: message.body.type, error: e instanceof Error ? e.name : "unknown" });
        }
      }
      // 失敗しても送り直さない(返信が二重に届くのを避ける。整理の失敗は LINE で知らせている)
      message.ack();
    }
  },
};
