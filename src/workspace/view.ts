// 拾枝工作台：顶栏（库/搜索）+ 左树 + 信息流 + 右栏邻接 + 底部输入栏。
// 只读 Obsidian 的公开 API 与 Markdown；不引入任何自有文件格式。
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { buildTree, Member, relatedOf, TreeNode } from '../project/scan';
import { parseCapture } from '../capture/parse';

export const VIEW_TYPE = 'lifelog-workspace';

export type WorkspaceDeps = {
  root: () => string;
  members: () => Member[];
  reload: () => Promise<void>;
  capture: (text: string) => Promise<void>;
  open: (path: string) => Promise<void>;
  edit: (path: string) => void;
};

export class WorkspaceView extends ItemView {
  private deps: WorkspaceDeps;
  private query = '';
  private selected: { key: string; name: string } | null = null;
  private collapsed = new Set<string>();

  constructor(leaf: WorkspaceLeaf, deps: WorkspaceDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return '拾枝';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    const el = this.contentEl;
    el.empty();
    el.addClass('lifelog-ws');
    const members = this.deps.members();
    const notes = members.filter((m) => m.kind === 'note');
    const entities = members.filter((m) => m.kind === 'entity');

    // ── 顶栏 ─────────────────────────────────────────────
    const bar = el.createDiv({ cls: 'lifelog-ws-bar' });
    bar.createSpan({ cls: 'lifelog-ws-lib', text: this.deps.root().split('/').pop() ?? '拾枝' });
    const search = bar.createEl('input', { cls: 'lifelog-ws-search', attr: { placeholder: '搜索笔记与标签…' } });
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      void this.render();
    });
    bar.createSpan({ cls: 'lifelog-ws-count', text: `笔记 ${notes.length} · 实体 ${entities.length}` });

    // ── 主体三栏 ─────────────────────────────────────────
    const body = el.createDiv({ cls: 'lifelog-ws-body' });
    const left = body.createDiv({ cls: 'lifelog-ws-tree' });
    const main = body.createDiv({ cls: 'lifelog-ws-stream' });
    const right = body.createDiv({ cls: 'lifelog-ws-side' });

    this.renderTree(left, buildTree(members));

    const q = this.query.trim();
    const shown = notes
      .filter((m) => !q || m.title.includes(q) || m.tags.some((t) => t.includes(q)))
      .sort((a, b) => (a.created < b.created ? 1 : -1));
    main.createDiv({ cls: 'lifelog-ws-head', text: q ? `筛选：${q}（${shown.length}）` : `信息流（${shown.length}）` });
    for (const n of shown.slice(0, 300)) {
      const row = main.createDiv({ cls: 'lifelog-ws-item' });
      row.createDiv({ cls: 'lifelog-ws-item-title', text: n.title }).addEventListener('click', () => void this.deps.open(n.path));
      const meta = row.createDiv({ cls: 'lifelog-ws-item-meta' });
      if (n.created) meta.createSpan({ text: n.created.slice(0, 16) });
      for (const t of n.tags.slice(0, 6)) meta.createSpan({ cls: 'lifelog-ws-tag', text: `#${t}` });
      for (const r of n.rels) meta.createSpan({ cls: 'lifelog-ws-rel', text: `${r.name} → ${r.to}` });
    }

    this.renderSide(right, members);
    this.renderInput(el);
  }

  private renderTree(box: HTMLElement, roots: TreeNode[]): void {
    box.createDiv({ cls: 'lifelog-ws-head', text: '树' });
    const walk = (n: TreeNode, depth: number) => {
      const row = box.createDiv({ cls: 'lifelog-ws-tree-row' });
      row.style.paddingLeft = `${depth * 12}px`;
      row.createSpan({ cls: 'lifelog-ws-tree-name', text: n.name });
      row.createSpan({ cls: 'lifelog-ws-tree-count', text: (n as TreeNode & { subtree?: number }).subtree ? `${n.self}/${n.subtree}` : `${n.self}` });
      const pen = row.createSpan({ cls: 'lifelog-ws-pen', text: '✎' });
      pen.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.deps.edit(n.path);
      });
      row.addEventListener('click', () => {
        this.selected = { key: n.key, name: n.name };
        void this.render();
      });
      if (!this.collapsed.has(n.name)) n.children.forEach((c) => walk(c, depth + 1));
    };
    roots.slice(0, 200).forEach((r) => walk(r, 0));
  }

  private renderSide(box: HTMLElement, members: Member[]): void {
    const sel = this.selected;
    box.createDiv({ cls: 'lifelog-ws-head', text: sel ? `邻接：${sel.name}` : '邻接' });
    if (!sel) {
      box.createDiv({ cls: 'lifelog-ws-hint', text: '点左边的实体看它连着什么' });
      return;
    }
    const related = relatedOf(members, sel.key, sel.name);
    box.createDiv({ cls: 'lifelog-ws-hint', text: `${related.length} 条关联` });
    for (const m of related.slice(0, 60)) {
      const row = box.createDiv({ cls: 'lifelog-ws-side-row', text: m.title });
      row.addEventListener('click', () => void this.deps.open(m.path));
    }
  }

  private renderInput(el: HTMLElement): void {
    const bar = el.createDiv({ cls: 'lifelog-ws-input' });
    const input = bar.createEl('input', { cls: 'lifelog-ws-input-field', attr: { placeholder: '记点什么…  #标签  [[链接]]  /命令  >父级' } });
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await this.deps.capture(text);
      await this.deps.reload();
      await this.render();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        void submit();
      }
    });
    bar.createEl('button', { cls: 'lifelog-ws-send', text: '保存' }).addEventListener('click', () => void submit());
    bar.createSpan({
      cls: 'lifelog-ws-hint',
      text: parseHint(),
    });
  }
}

function parseHint(): string {
  const demo = parseCapture('示例 #标签 [[链接]] >父级');
  return `解析：${demo.tags.length} 标签 / ${demo.links.length} 链接 / ${demo.parent ?? '无父级'}`;
}
