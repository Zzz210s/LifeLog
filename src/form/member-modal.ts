// 成员表单：编辑一个「点」的父子/标签/命名关系。只改 frontmatter 的管理键，正文一字不动。
import { App, Modal, Notice, Setting, TFile } from 'obsidian';

export type MemberForm = { path: string; parent: string; tags: string; relations: string };

const MANAGED = /^(lifelog_kind|lifelog_created|lifelog_parent|tags)\s*:/;

/** 把 frontmatter 拆成 (已有行, 正文)，正文原样保留。 */
export function splitNote(raw: string): { head: string[]; body: string } {
  if (!raw.startsWith('---')) return { head: [], body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { head: [], body: raw };
  const head = raw.slice(3, end).split('\n').filter((l) => l.trim().length > 0);
  const body = raw.slice(end + 4).replace(/^\n/, '');
  return { head, body };
}

/** 只替换插件管理的键；其余键（含用户的命名关系、自定义字段）原样保留。 */
export function rewriteNote(raw: string, form: MemberForm): string {
  const { head, body } = splitNote(raw);
  const tags = form.tags.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean);
  const kept = head.filter((l) => !MANAGED.test(l));
  const next = [...kept];
  if (form.parent.trim()) next.push(`lifelog_parent: ${form.parent.trim()}`);
  if (tags.length > 0) next.push(`tags: [${tags.join(', ')}]`);
  for (const line of form.relations.split('\n')) {
    const m = line.match(/^([^=:]+)[=:]\s*(.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    const target = m[2].trim().replace(/^\[\[|\]\]$/g, '');
    next.push(`${name}: "[[${target}]]"`);
  }
  return `---\n${next.join('\n')}\n---\n\n${body}`;
}

export class MemberModal extends Modal {
  form: MemberForm;

  private file: TFile;
  private onSave: () => void;

  constructor(app: App, file: TFile, initial: MemberForm, onSave: () => void) {
    super(app);
    this.file = file;
    this.onSave = onSave;
    this.form = { ...initial };
  }

  onOpen(): void {
    this.titleEl.setText(`编辑：${this.file.basename}`);
    new Setting(this.contentEl)
      .setName('父级')
      .setDesc('实体 key，如 地点/中国大陆；留空表示根')
      .addText((t) => t.setValue(this.form.parent).onChange((v) => (this.form.parent = v)));
    new Setting(this.contentEl)
      .setName('标签')
      .setDesc('逗号分隔，如 地点/印度, 状态/未完成')
      .addText((t) => t.setValue(this.form.tags).onChange((v) => (this.form.tags = v)));
    new Setting(this.contentEl)
      .setName('命名关系')
      .setDesc('每行一条：关系名=目标，如 国籍=地点/日本')
      .addTextArea((t) => t.setValue(this.form.relations).onChange((v) => (this.form.relations = v)));
    new Setting(this.contentEl).addButton((b) =>
      b.setButtonText('保存').setCta().onClick(async () => {
        await this.app.vault.process(this.file, (raw) => rewriteNote(raw, this.form));
        new Notice(`已保存：${this.file.basename}`);
        this.onSave();
        this.close();
      }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
