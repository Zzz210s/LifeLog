// 工作台的打开与成员缓存（从 main.ts 抽出，守 200 行红线）。
import { App } from 'obsidian';
import { Member, readMembers } from '../project/scan';
import { VIEW_TYPE } from './view';

export class MemberCache {
  private data: Member[] | null = null;

  constructor(private app: App, private root: () => string) {}

  get(): Member[] {
    this.data ??= readMembers(this.app, this.root());
    return this.data;
  }

  clear(): void {
    this.data = null;
  }
}

export async function openWorkspace(app: App): Promise<void> {
  const leaf = app.workspace.getLeaf(true);
  await leaf.setViewState({ type: VIEW_TYPE, active: true });
}
