import path from "node:path";
import { Font, renderToBuffer } from "@react-pdf/renderer";
import { japaneseLineBreak } from "./line-break";
import { PDF_FONT_FAMILY, ReportDocument, type ReportDocumentProps } from "./ReportDocument";

// 日本語フォント(Noto Sans JP、SIL Open Font License 1.1)。ライセンスは assets/fonts/OFL.txt
// next.config.ts の outputFileTracingIncludes で、本番のサーバーにも含める
const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

let registered = false;

function registerFonts() {
  if (registered) return;
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: path.join(FONT_DIR, "NotoSansJP-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "NotoSansJP-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback(japaneseLineBreak);
  registered = true;
}

export async function renderReportPdf(props: ReportDocumentProps): Promise<Uint8Array> {
  registerFonts();
  const buffer = await renderToBuffer(<ReportDocument {...props} />);
  return new Uint8Array(buffer);
}
