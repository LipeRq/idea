/**
 * 常に出す「送信しません」の表示。言うのは事実だけ(誇張しない)。
 * 「仕組み」は新しいタブで開く(解析結果はこのタブのメモリにしかないため、同じタブで移動すると消える)。
 */
export function PrivacyBadge() {
  return (
    <p className="no-print inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-good bg-good-soft px-3 py-1 text-sm text-good">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
        <path d="M10 1.5 3 4.5v5c0 4.2 2.9 8 7 9 4.1-1 7-4.8 7-9v-5l-7-3Zm-1 12.1-3.3-3.3 1.4-1.4L9 10.8l3.9-3.9 1.4 1.4L9 13.6Z" />
      </svg>
      <span>このブラウザの中で解析しています(ファイルは送信しません)</span>
      <a href="/how-it-works" target="_blank" rel="noopener" className="underline underline-offset-2">
        仕組み<span className="sr-only">(新しいタブで開きます)</span>
      </a>
    </p>
  );
}
