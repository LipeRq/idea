import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BaselineSchema } from "../domain/impact";
import { InquirySchema, type Inquiry } from "../domain/inquiry";
import { SAFE_ID, type MockCrmRecord, type Storage } from "./types";

// ローカルディスクへの保存。1件1ファイルのJSONで、書き込みは一時ファイル+renameで置き換える。
// 1台のサーバーで動かす前提(複数台にするときはRDBの実装に置き換える)。
// 保存先は実行時の環境変数で決まるため、ビルド時のファイルトレースからは外す(turbopackIgnore)。

async function writeAtomic(file: string, data: string | Uint8Array) {
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, data);
  await rename(/*turbopackIgnore: true*/ tmp, file);
}

async function readOrNull(file: string): Promise<Buffer | null> {
  try {
    return await readFile(/*turbopackIgnore: true*/ file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function checkId(id: string) {
  if (!SAFE_ID.test(id)) throw new Error("不正なidです");
}

export function createFileStorage(root: string): Storage {
  const inquiryDir = path.join(root, "inquiries");
  const blobDir = path.join(root, "blobs");
  const crmFile = path.join(root, "mock-crm.json");
  const baselineFile = path.join(root, "impact-baseline.json");

  const readCrm = async (): Promise<MockCrmRecord[]> => {
    const buf = await readOrNull(crmFile);
    return buf ? (JSON.parse(buf.toString("utf8")) as MockCrmRecord[]) : [];
  };

  return {
    inquiries: {
      async list() {
        let names: string[] = [];
        try {
          names = (await readdir(/*turbopackIgnore: true*/ inquiryDir)).filter((n) => n.endsWith(".json"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const items = await Promise.all(
          names.map(async (n) => {
            const buf = await readOrNull(path.join(inquiryDir, n));
            const parsed = buf ? InquirySchema.safeParse(JSON.parse(buf.toString("utf8"))) : null;
            return parsed?.success ? parsed.data : null;
          }),
        );
        return items
          .filter((i): i is Inquiry => i !== null)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },
      async get(id) {
        if (!SAFE_ID.test(id)) return null;
        const buf = await readOrNull(path.join(inquiryDir, `${id}.json`));
        if (!buf) return null;
        return InquirySchema.parse(JSON.parse(buf.toString("utf8")));
      },
      async save(inquiry) {
        checkId(inquiry.id);
        await writeAtomic(path.join(inquiryDir, `${inquiry.id}.json`), JSON.stringify(InquirySchema.parse(inquiry), null, 2));
      },
      async delete(id) {
        checkId(id);
        await rm(/*turbopackIgnore: true*/ path.join(inquiryDir, `${id}.json`), { force: true });
      },
    },
    blobs: {
      async put(key, data) {
        checkId(key);
        await writeAtomic(path.join(blobDir, key), data);
      },
      async get(key) {
        if (!SAFE_ID.test(key)) return null;
        const buf = await readOrNull(path.join(blobDir, key));
        return buf ? new Uint8Array(buf) : null;
      },
      async delete(key) {
        checkId(key);
        await rm(/*turbopackIgnore: true*/ path.join(blobDir, key), { force: true });
      },
    },
    mockCrm: {
      list: readCrm,
      async add(record) {
        const records = await readCrm();
        records.push(record);
        await writeAtomic(crmFile, JSON.stringify(records, null, 2));
      },
    },
    impact: {
      async getBaseline() {
        const buf = await readOrNull(baselineFile);
        if (!buf) return null;
        const parsed = BaselineSchema.safeParse(JSON.parse(buf.toString("utf8")));
        return parsed.success ? parsed.data : null;
      },
      async saveBaseline(baseline) {
        await writeAtomic(baselineFile, JSON.stringify(BaselineSchema.parse(baseline), null, 2));
      },
      async deleteBaseline() {
        await rm(/*turbopackIgnore: true*/ baselineFile, { force: true });
      },
    },
  };
}
