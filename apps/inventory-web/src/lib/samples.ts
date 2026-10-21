// 「サンプルで試す」のファイルを取得する(自社サーバーからの GET だけ。ファイル由来の情報は送らない)。
// 通信を書ける場所を限定するため、fetch を使うのはこのファイルと engine-loader.ts・ai-client.ts だけ。

export interface SampleEntry {
  file: string;
  title: string;
  description: string;
  highlights: string[];
}

export async function fetchSampleFile(entry: SampleEntry): Promise<File> {
  const res = await fetch(`/samples/${encodeURIComponent(entry.file)}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new File([blob], entry.file, { type: blob.type });
}
