import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { BrandMark } from "./brand-mark";
import { SERVICE_NAME } from "./site";

// SNSで共有されたときの画像(opengraph-image / twitter-image)。ビルド時に1回だけ作られる。
// 日本語フォントは PDF と同じ Noto Sans JP(assets/fonts、SIL Open Font License 1.1)を使う。

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_IMAGE_ALT = "御社の業務、AIでどれだけ減らせるか。無料のAI導入診断";

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FONT_FAMILY = "NotoSansJP";

// globals.css のライトモードの色
const C = {
  page: "#f9f9f7",
  surface: "#ffffff",
  ink: "#0b0b0b",
  ink2: "#52514e",
  line: "#e4e3df",
  accent: "#2a78d6",
  accentStrong: "#1c5cab",
  track: "#cde2fb",
};

// リクエストに関係なく同じなので、モジュールの読み込み時に1回だけ読む(ビルド時に静的な画像になる)
const [regular, bold] = await Promise.all([
  readFile(path.join(FONT_DIR, "NotoSansJP-Regular.ttf")),
  readFile(path.join(FONT_DIR, "NotoSansJP-Bold.ttf")),
]);

const SAMPLE_BARS = [
  { label: "議事録・報告書の作成", width: 100 },
  { label: "問い合わせ・メール対応", width: 72 },
  { label: "データ入力・転記", width: 48 },
];

export function renderOgImage(operator?: string): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: C.page,
          fontFamily: FONT_FAMILY,
          color: C.ink,
        }}
      >
        <div style={{ height: 14, background: C.accent }} />
        <div style={{ display: "flex", flex: 1, padding: "48px 72px 44px" }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: C.accentStrong }}>無料・約3分</div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 14,
                fontSize: 64,
                fontWeight: 700,
                lineHeight: 1.25,
              }}
            >
              <span>御社の業務、</span>
              <span>AIでどれだけ</span>
              <span>減らせるか。</span>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 20,
                fontSize: 27,
                lineHeight: 1.5,
                color: C.ink2,
              }}
            >
              <span>業務時間とIT環境を入力するだけで、</span>
              <span>削減できる業務・削減額・ロードマップがわかります</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", marginTop: "auto", gap: 18 }}>
              <BrandMark size={56} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 32, fontWeight: 700 }}>{SERVICE_NAME}</span>
                {operator && <span style={{ fontSize: 22, color: C.ink2 }}>{operator}</span>}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignSelf: "center",
              width: 360,
              marginLeft: 40,
              padding: "28px 28px 32px",
              borderRadius: 20,
              border: `2px solid ${C.line}`,
              background: C.surface,
            }}
          >
            <span style={{ fontSize: 22, color: C.ink2 }}>年間の削減見込み額</span>
            <span style={{ fontSize: 48, fontWeight: 700, marginTop: 4 }}>業務別に試算</span>
            {SAMPLE_BARS.map((b) => (
              <div key={b.label} style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
                <span style={{ fontSize: 20, color: C.ink2 }}>{b.label}</span>
                <div
                  style={{
                    display: "flex",
                    marginTop: 8,
                    height: 18,
                    borderRadius: 9,
                    background: C.track,
                  }}
                >
                  <div
                    style={{
                      width: `${b.width}%`,
                      height: 18,
                      borderRadius: 9,
                      background: C.accent,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: FONT_FAMILY, data: regular, weight: 400, style: "normal" },
        { name: FONT_FAMILY, data: bold, weight: 700, style: "normal" },
      ],
    },
  );
}
