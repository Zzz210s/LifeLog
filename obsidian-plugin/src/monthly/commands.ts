// 迁移与共现这两条命令的执行体（从 main.ts 抽出，守 200 行红线）。
import type { App, Notice as NoticeType } from 'obsidian';
import { Notice } from 'obsidian';
import { migrateToMonths } from './run';
import { rebuildCooccurrences } from '../store/cooccur-run';

type Host = {
  app: App;
  settings: { root: string };
  cache: { clear: () => void };
  readRecords: () => Promise<import('../store/schema').PointRecord[]>;
};

export async function runMigrate(host: Host): Promise<void> {
  const stop: NoticeType = new Notice('迁移中…', 0);
  const progress: NoticeType = new Notice('迁移中… 0%', 0);
  const r = await migrateToMonths(host.app, host.settings.root, (done, total) => {
    progress.setMessage(`迁移中… ${Math.round((done / Math.max(total, 1)) * 100)}%（${done}/${total}）`);
  });
  progress.hide();
  host.cache.clear();
  stop.hide();
  new Notice(`迁移完成：${r.months} 个月度文件、${r.entries} 条；归档 ${r.archived} 个旧文件，跳过 ${r.skipped} 条空笔记，失败 ${r.errors}`, 15000);
}

export async function runCooccur(host: Host): Promise<void> {
  const touched = await rebuildCooccurrences(host.app, host.settings.root, await host.readRecords());
  new Notice(`共现区块已更新 ${touched} 个实体`);
}
