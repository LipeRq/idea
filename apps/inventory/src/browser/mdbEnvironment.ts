// ブラウザ用バンドルで mdb-reader の lib/browser/environment/index.js の代わりに使うモジュール。
// 元のモジュールは browserify-aes / create-hash / pako を読み込み、それらが Node.js の stream などの
// ポリフィルを必要とするため、ここで置き換える。暗号化されていない .accdb / .mdb(と Jet4 の簡易暗号化)は
// これらを使わずに読めるので、パスワードで暗号化された .accdb だけをブラウザ版では未対応にする。
import { Buffer } from "buffer";
import { unzlibSync } from "fflate";
import { UnsupportedFileError } from "../errors";

function unsupported(): never {
  throw new UnsupportedFileError(
    "パスワードで暗号化された Access データベースは、ブラウザ版では解析できません。コマンドライン版(--password)を使ってください",
  );
}

export const createDecipheriv = unsupported;
export const createHash = unsupported;
export const environment = {
  inflate: (data: Uint8Array) => Buffer.from(unzlibSync(data)),
};
