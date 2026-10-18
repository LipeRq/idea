import { InquirySchema, type Inquiry } from "../domain/inquiry";
import type { MockCrmRecord, Storage } from "./types";

// メモリ上の保存(テスト用)。保存時にファイル実装と同じ検証をかける。
export function createMemoryStorage(): Storage {
  const inquiries = new Map<string, Inquiry>();
  const blobs = new Map<string, Uint8Array>();
  const crm: MockCrmRecord[] = [];
  const clone = <T>(v: T): T => structuredClone(v);
  return {
    inquiries: {
      list: async () => [...inquiries.values()].map(clone).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      get: async (id) => (inquiries.has(id) ? clone(inquiries.get(id)!) : null),
      save: async (inquiry) => void inquiries.set(inquiry.id, clone(InquirySchema.parse(inquiry))),
      delete: async (id) => void inquiries.delete(id),
    },
    blobs: {
      put: async (key, data) => void blobs.set(key, new Uint8Array(data)),
      get: async (key) => blobs.get(key) ?? null,
      delete: async (key) => void blobs.delete(key),
    },
    mockCrm: {
      list: async () => crm.map(clone),
      add: async (record) => void crm.push(clone(record)),
    },
  };
}
