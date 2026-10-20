import { ImageResponse } from "next/og";
import { BrandMark } from "@/lib/brand-mark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  // iOS はホーム画面で角を丸めるので、背景いっぱいに描く
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#1c5cab" }}>
        <BrandMark size={180} />
      </div>
    ),
    size,
  );
}
