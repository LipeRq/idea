// Access は VBA プロジェクトを MSysAccessStorage テーブルにツリー構造で保存している。
// ルート → VBA → VBAProject → { VBA → { dir, _VBA_PROJECT, モジュール }, PROJECT, PROJECTwm }
import type { VbaStorage } from "../vba/project";

export interface StorageRow {
  id: number;
  parentId: number;
  name: string;
  type: number;
  data: Uint8Array | null;
}

export const ACCESS_VBA_ROOT = "VBA/VBAProject";

export function accessStorage(rows: StorageRow[], root = ACCESS_VBA_ROOT): VbaStorage {
  const children = new Map<number, StorageRow[]>();
  for (const r of rows) {
    if (r.id === r.parentId) continue;
    const list = children.get(r.parentId) ?? [];
    list.push(r);
    children.set(r.parentId, list);
  }
  const rootRow = rows.find((r) => r.name === "MSysAccessStorage_ROOT") ?? rows.find((r) => r.id === r.parentId);
  const find = (path: string): StorageRow | null => {
    if (!rootRow) return null;
    let node: StorageRow = rootRow;
    for (const seg of path.split("/").filter(Boolean)) {
      const next = (children.get(node.id) ?? []).find((c) => c.name.toLowerCase() === seg.toLowerCase());
      if (!next) return null;
      node = next;
    }
    return node;
  };
  return {
    read: (path) => {
      const row = find(`${root}/${path}`);
      return row && row.type === 2 ? (row.data ?? new Uint8Array()) : null;
    },
  };
}
