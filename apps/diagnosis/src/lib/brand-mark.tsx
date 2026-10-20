// ファビコン(src/app/icon.svg)と同じ、削減を表す3本の棒。OGP画像とアプリアイコンで使う(next/og 用)

export function BrandMark({ size }: { size: number }) {
  const unit = size / 32;
  const bar = (x: number, y: number) => (
    <div
      style={{
        position: "absolute",
        left: x * unit,
        top: y * unit,
        width: 5 * unit,
        height: (24 - y) * unit,
        borderRadius: 1.5 * unit,
        background: "#ffffff",
      }}
    />
  );
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: size,
        height: size,
        borderRadius: 7 * unit,
        background: "#1c5cab",
      }}
    >
      {bar(7, 8)}
      {bar(13.5, 12)}
      {bar(20, 16)}
    </div>
  );
}
