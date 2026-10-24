// LINE の Webhook の受け口(https://<プロジェクト>.vercel.app/api/webhook)。
// 処理の中身は src/webhook/handler.ts。ここでは環境変数を読み、本物の LINE・Claude をつなぐだけ。
import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { createClaudeClient, hasAnthropicCredentials } from "../../../claude";
import { createLineApi } from "../../../line/api";
import { organizeMeetingNotes } from "../../../meeting/notes";
import { handleWebhook, readWebhookConfig, type Logger } from "../../../webhook/handler";

// 整理(Claude の呼び出しは90秒まで)と返信を、応答のあとに after で行うので、その分の時間を取る
export const maxDuration = 120;

const log: Logger = (event, fields) => console.log(JSON.stringify({ event, ...fields }));

export async function POST(request: Request): Promise<Response> {
  const result = readWebhookConfig(process.env);
  if (!result.ok) {
    log("config_missing", { names: result.missing.join(",") });
    return new Response("Server Not Configured", { status: 500 });
  }
  const { config } = result;
  const claude = hasAnthropicCredentials() ? createClaudeClient(new Anthropic()) : null;
  return handleWebhook(request, {
    config,
    line: createLineApi(config.channelAccessToken),
    organize: claude ? (input) => organizeMeetingNotes(input, claude, new Date()) : null,
    defer: (task) => after(() => task),
    log,
  });
}
