// playwright.config.ts とテストの両方で使う値

/** E2Eのビルドに埋め込む公開URL(OGP・robots・sitemap の確認に使う。実在しないドメイン) */
export const E2E_SITE_URL = "https://shindan.example.com";

/** E2Eのビルドに埋め込む、棚卸しツールの画面のURL(関連ツールの案内のリンク先。実在しないドメイン) */
export const E2E_INVENTORY_TOOL_URL = "https://inventory.example.com/";
