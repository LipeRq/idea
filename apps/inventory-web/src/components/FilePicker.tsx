"use client";

import { useState } from "react";
import { formatFileSize, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from "@/lib/browser-limits";
import { ACCEPT_ATTRIBUTE, SUPPORTED_FORMATS_TEXT } from "@/lib/file-types";
import { buttonPrimary } from "./ui";

/**
 * ファイルの選択とドラッグ&ドロップ。<label> で <input type="file"> を包むので、
 * キーボードでは Tab で移動して Enter / Space で選択ダイアログが開く。
 */
export function FilePicker({ onFiles, disabled = false }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      data-dropzone="true"
      className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent sm:py-10 ${
        dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface"
      }`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        if (!disabled) onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <input
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        disabled={disabled}
        aria-describedby="file-picker-help"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          onFiles(files);
        }}
      />
      <span className="text-base font-semibold">解析するファイルをここにドラッグ&ドロップ</span>
      <span className="text-sm text-ink-2">または</span>
      <span className={buttonPrimary}>ファイルを選ぶ</span>
      <span id="file-picker-help" className="max-w-xl text-sm text-ink-2">
        対応: {SUPPORTED_FORMATS_TEXT}。1ファイル{formatFileSize(MAX_FILE_BYTES)}まで、一度に{MAX_FILES}ファイル(合計{formatFileSize(MAX_TOTAL_BYTES)})まで選べます。複数のファイルは「棚卸し一覧」で比べられます。
        パスワード付きの Access と、開くときにパスワードが必要なブックは解析できません。
      </span>
    </label>
  );
}
