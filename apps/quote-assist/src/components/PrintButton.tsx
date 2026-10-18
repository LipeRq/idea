"use client";

import { buttonSecondary } from "./ui";

export function PrintButton() {
  return (
    <button type="button" className={`no-print ${buttonSecondary}`} onClick={() => window.print()}>
      印刷・PDFで保存
    </button>
  );
}
