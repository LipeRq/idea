import type { Inquiry } from "../domain/inquiry";

// 保存先の差し替え点。MVPはファイルとメモリ。専用環境ではRDB(PostgreSQL / SQL Server)と
// オブジェクトストレージ(S3 / Azure Blob、国内リージョン)の実装を足す。

export interface InquiryRepository {
  list(): Promise<Inquiry[]>;
  get(id: string): Promise<Inquiry | null>;
  save(inquiry: Inquiry): Promise<void>;
  delete(id: string): Promise<void>;
}

/** 図面PDFの本体 */
export interface BlobStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/** モックのSalesforceに登録された内容(デモ画面で表示する) */
export type MockCrmRecord = {
  inquiryId: string;
  registeredAt: string;
  opportunity: Record<string, unknown> & { Id: string };
  quote: Record<string, unknown> & { Id: string };
};

export interface MockCrmRepository {
  list(): Promise<MockCrmRecord[]>;
  add(record: MockCrmRecord): Promise<void>;
}

export type Storage = {
  inquiries: InquiryRepository;
  blobs: BlobStore;
  mockCrm: MockCrmRepository;
};

/** パスに使うidの検査(ディレクトリをさかのぼる指定を防ぐ) */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
