"use client";

import { useState } from "react";
import { inputClass } from "./ui";

// 小数の途中入力(「1.」など)を保てるよう、表示は文字列で持ち、数として正しいときだけ親に渡す。
// 外から値を戻すときは key を変えて作り直す。
export function NumberField({
  value,
  onChange,
  label,
  step = "any",
  min = 0,
  max,
  placeholder,
  allowEmpty = false,
  disabled = false,
  className = "",
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  step?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const invalid =
    text.trim() === "" ? !allowEmpty : !(Number.isFinite(Number(text)) && Number(text) >= min && (max === undefined || Number(text) <= max));
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      disabled={disabled}
      value={text}
      className={`${inputClass} tabular-nums ${invalid ? "border-critical" : ""} ${className}`}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") {
          if (allowEmpty) onChange(null);
          return;
        }
        const n = Number(t);
        if (Number.isFinite(n) && n >= min && (max === undefined || n <= max)) onChange(n);
      }}
    />
  );
}
