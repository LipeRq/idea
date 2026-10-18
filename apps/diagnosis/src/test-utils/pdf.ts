import { extractText, getDocumentProxy } from "unpdf";

// テスト用:PDFとして開けるかを PDF.js(unpdf)で確かめ、本文の文字を取り出す。
// 改行や文字の区切りで空白が入るので、比べるときは空白を除いた compact を使う。
export async function readPdf(data: Uint8Array) {
  // PDF.js は渡したバッファを手放す(detach)ので、写しを渡す
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const { info } = await pdf.getMetadata();
  const title = (info as { Title?: string }).Title;
  return { totalPages, text, compact: text.replace(/\s+/g, ""), title };
}
