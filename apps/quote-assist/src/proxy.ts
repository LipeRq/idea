// すべてのリクエストの前に、誤って公開したときの歯止め(Basic 認証)を確かめる。設定は src/lib/security/basic-auth.ts。
// matcher を指定しないので、静的ファイル(_next/static・public/)を含むすべてのリクエストに効く。
import { NextResponse, type NextRequest } from "next/server";
import { accessConfigFromEnv, checkAccess } from "./lib/security/basic-auth";

const HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

export function proxy(request: NextRequest) {
  const result = checkAccess(request.headers.get("authorization"), accessConfigFromEnv(process.env));
  if (result === "allow") return NextResponse.next();
  if (result === "locked") {
    // 認証の設定がない本番環境。ブラウザに入力欄を出しても通らないので、認証の要求(WWW-Authenticate)は付けない
    return new NextResponse(
      "This server requires QUOTE_ASSIST_BASIC_AUTH_USER / QUOTE_ASSIST_BASIC_AUTH_PASSWORD (or QUOTE_ASSIST_ALLOW_NO_AUTH=true).",
      { status: 401, headers: HEADERS },
    );
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { ...HEADERS, "WWW-Authenticate": 'Basic realm="quote-assist", charset="UTF-8"' },
  });
}
