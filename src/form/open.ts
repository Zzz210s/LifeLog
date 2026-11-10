// 成员表单的打开入口（从 main.ts 抽出，守 200 行红线）。
import { App, TFile } from 'obsidian';
import { Member } from '../project/scan';
import { MemberModal } from './member-modal';

export function openMemberForm(app: App, members: Member[], path: string, onSave: () => void): void {
  const f = app.vault.getAbstractFileByPath(path);
  if (!(f instanceof TFile)) return;
  const m = members.find((x) => x.path === path);
  new MemberModal(
    app,
    f,
    {
      path,
      parent: m?.parent ?? '',
      tags: (m?.tags ?? []).join(', '),
      relations: (m?.rels ?? []).map((r) => `${r.name}=${r.to}`).join(String.fromCharCode(10)),
    },
    onSave,
  ).open();
}
