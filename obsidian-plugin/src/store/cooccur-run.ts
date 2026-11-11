// 共现区块的执行入口（从 main.ts 抽出）。
import { App } from 'obsidian';
import { cooccurrence, neighborsOf, renderBlock, upsertBlock } from './cooccur';
import { PointRecord } from './schema';

export async function rebuildCooccurrences(app: App, root: string, records: PointRecord[]): Promise<number> {
  const pairs = cooccurrence(records, 2);
  let touched = 0;
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(`${root}/实体/`)) continue;
    const name = f.path.replace(/^.*\/实体\//, '').replace(/\.md$/, '');
    const near = neighborsOf(pairs, name);
    if (near.length === 0) continue;
    const body = await app.vault.read(f);
    const next = upsertBlock(body, renderBlock(near, name));
    if (next !== body) {
      await app.vault.modify(f, next);
      touched += 1;
    }
  }
  return touched;
}
