import type { ReactNode } from "react";

// 外部へのリンク(相談ページ・プライバシーポリシーだけ)。新しいタブで開き、解析結果のある画面を残す。
// URL に解析結果などを一切付けない。参照元も送らない(rel="noreferrer")。
export function ExternalLink({ href, children, className = "underline underline-offset-2" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only">(新しいタブで開きます)</span>
    </a>
  );
}
