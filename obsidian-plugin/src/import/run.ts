// 把 buildFiles 的产物写进 vault：冲突不覆盖（追加后缀），带进度与汇总。
import { FileOut } from './map';

export type VaultWriter = {
  exists(path: string): boolean;
  ensureFolder(dir: string): Promise<void>;
  create(path: string, content: string): Promise<void>;
};

export type ImportResult = { created: number; renamed: number; skipped: number; dirs: number };

/** 冲突时依次尝试 `-2`、`-3`……；`-1` 留给「同 id 已存在但内容不同」的情况由调用方决定。 */
export function freePath(base: string, exists: (p: string) => boolean, limit = 50): string | null {
  if (!exists(base)) return base;
  const m = base.match(/^(.*?)(\.md)$/);
  const stem = m ? m[1] : base;
  const ext = m ? m[2] : '';
  for (let i = 2; i <= limit; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return null;
}

export async function importFiles(
  files: FileOut[],
  writer: VaultWriter,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, renamed: 0, skipped: 0, dirs: 0 };
  const seenDirs = new Set<string>();
  let done = 0;
  for (const file of files) {
    const dir = file.path.split('/').slice(0, -1).join('/');
    if (dir && !seenDirs.has(dir)) {
      seenDirs.add(dir);
      await writer.ensureFolder(dir);
      result.dirs += 1;
    }
    const target = freePath(file.path, writer.exists);
    if (target === null) {
      result.skipped += 1;
    } else {
      await writer.create(target, file.content);
      result.created += 1;
      if (target !== file.path) result.renamed += 1;
    }
    done += 1;
    if (onProgress && done % 50 === 0) onProgress(done, files.length);
  }
  onProgress?.(files.length, files.length);
  return result;
}

/** 汇总文案（通知里只给这几项，避免刷屏）。 */
export function summaryText(r: ImportResult): string {
  const parts = [`新建 ${r.created} 个文件`, `目录 ${r.dirs} 个`];
  if (r.renamed > 0) parts.push(`改名 ${r.renamed} 个（原路径已存在，未覆盖）`);
  if (r.skipped > 0) parts.push(`跳过 ${r.skipped} 个`);
  return parts.join('，');
}
