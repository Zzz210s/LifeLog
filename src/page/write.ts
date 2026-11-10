// LifeLog 页面的写入执行体（从 main.ts 抽出）。
import { App, TFile } from 'obsidian';
import { homePage } from './home';

export async function writeHomePage(app: App, root: string, counts: { notes: number; entities: number }, bases: string[]): Promise<void> {
  const md = homePage({ root, library: root.split('/').pop() ?? '拾枝', counts: { ...counts, relations: 0 }, bases });
  const path = `${root}/LifeLog.md`;
  const exist = app.vault.getAbstractFileByPath(path);
  if (exist instanceof TFile) await app.vault.modify(exist, md);
  else await app.vault.create(path, md);
  await app.workspace.openLinkText(path, '', false);
}
