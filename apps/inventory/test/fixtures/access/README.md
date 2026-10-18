# Access のテスト用データベース

このディレクトリのファイルは [Jackcess](https://github.com/jahlborn/jackcess) のテストデータ
(`src/test/data/` 配下、コミット be0a2139b087a227d14cafd4ea231306a5a3a862)をそのまま複製したものです。
Jackcess は Apache License 2.0 で配布されています(全文は `LICENSE-jackcess.txt`)。

| ファイル | 元のパス | 用途 |
| --- | --- | --- |
| queryTestV2010.accdb | src/test/data/V2010/queryTestV2010.accdb | 保存済みクエリ9種の SQL 復元 |
| queryTestV2003.mdb | src/test/data/V2003/queryTestV2003.mdb | .mdb(Jet4)の読み取り |
| linkerTestV2007.accdb | src/test/data/V2007/linkerTestV2007.accdb | Access リンクテーブル・リレーションシップ |
| odbcLinkerTestV2007.accdb | src/test/data/V2007/odbcLinkerTestV2007.accdb | ODBC リンクテーブル(接続文字列のパスワードはダミー) |

| ファイル | 元のパス | 用途 |
| --- | --- | --- |
| V2010_with-password.accdb | test/password/data/V2010_with-password.accdb | データベースパスワード(パスワードは `password`) |

`V2010_with-password.accdb` は [mdb-reader](https://github.com/andipaetzold/mdb-reader)(MIT License、Copyright (c) 2020 Andi Pätzold、
コミット 3dc637a9732db79a3bf67506b82a4f83cf07e6a9)のテストデータを複製したものです(ライセンス全文は `LICENSE-mdb-reader.txt`)。
