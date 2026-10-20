"use client";

import { useState } from "react";
import { inputClass } from "./ui";

// 小数の途中入力(「1.」など)を保てるよう、表示は文字列で持ち、数として正しいときだけ親に渡す。
// 正しくない入力の間は親の値が前のままになるので、onValidityChange で知らせる(親は保存・承認を止める)。
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
  integer = false,
  onValidityChange,
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
  /** 整数だけを受け付ける(数量など) */
  integer?: boolean;
  onValidityChange?: (invalid: boolean) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const isInvalid = (t: string) => {
    if (t.trim() === "") return !allowEmpty;
    const n = Number(t);
    return !(Number.isFinite(n) && n >= min && (max === undefined || n <= max) && (!integer || Number.isInteger(n)));
  };
  const invalid = isInvalid(text);
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
        if (isInvalid(t) !== invalid) onValidityChange?.(isInvalid(t));
        if (t.trim() === "") {
          if (allowEmpty) onChange(null);
          return;
        }
        if (!isInvalid(t)) onChange(Number(t));
      }}
    />
  );
}
