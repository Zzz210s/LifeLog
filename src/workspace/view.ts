// 拾枝主视图（照 Memoria 的架构）：输入卡片 + 时间倒序瀑布流 + 统计侧栏。
// 数据源 = 月度文件（`拾枝/YYYY-MM.md`）与未迁移的旧笔记，都是普通 Markdown。
import { ItemView, WorkspaceLeaf } from 'obsidian';
import { Entry, stats } from '../monthly/parse';

export const VIEW_TYPE = 'lifelog-workspace';

export type Deps = {
  root: () => string;
  entries: () => Promise<Entry[]>;
  send: (text: string) => Promise<void>;
  open: (file: string) => Promise<void>;
};

const pad = (n: number) => String(n).padStart(2, '0');

export class WorkspaceView extends ItemView {
  private deps: Deps;
  private filter = '';
  private data: Entry[] = [];

  constructor(leaf: WorkspaceLeaf, deps: Deps) {
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
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    this.data = await this.deps.entries();
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass('lifelog-ws');

    // 顶栏：库名 + 搜索
    const bar = el.createDiv({ cls: 'lifelog-ws-bar' });
    bar.createSpan({ cls: 'lifelog-ws-lib', text: this.deps.root().split('/').pop() ?? '拾枝' });
    const search = bar.createEl('input', { cls: 'lifelog-ws-search', attr: { placeholder: '搜索…' } });
    search.value = this.filter;
    search.addEventListener('input', () => {
      this.filter = search.value;
      this.render();
    });
    bar.createSpan({ cls: 'lifelog-ws-count', text: `${this.data.length} 条` });

    const body = el.createDiv({ cls: 'lifelog-ws-body' });
    const main = body.createDiv({ cls: 'lifelog-ws-stream' });
    const side = body.createDiv({ cls: 'lifelog-ws-side' });

    this.renderComposer(main);
    this.renderFeed(main);
    this.renderStats(side);
  }

  /** 输入卡片：多行、Ctrl/Cmd+Enter 发送 */
  private renderComposer(box: HTMLElement): void {
    const card = box.createDiv({ cls: 'lifelog-ws-composer' });
    const input = card.createEl('textarea', {
      cls: 'lifelog-ws-input-field',
      attr: { placeholder: '记点什么…  #标签  [[链接]]  关系名:: [[目标]]  /命令  >父级', rows: '3' },
    });
    const actions = card.createDiv({ cls: 'lifelog-ws-actions' });
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await this.deps.send(text);
      await this.refresh();
    };
    actions.createEl('button', { cls: 'lifelog-ws-send', text: '发送' }).addEventListener('click', () => void send());
    actions.createSpan({ cls: 'lifelog-ws-hint', text: 'Ctrl/Cmd + Enter 发送' });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        void send();
      }
    });
    input.focus();
  }

  /** 瀑布流：按文件（年月）分组，组内时间倒序 */
  private renderFeed(box: HTMLElement): void {
    const q = this.filter.trim().toLowerCase();
    const rows = this.data.filter(
      (e) => !q || e.text.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)),
    );
    const byFile = new Map<string, Entry[]>();
    for (const e of rows) {
      const list = byFile.get(e.file) ?? [];
      list.push(e);
      byFile.set(e.file, list);
    }
    for (const [file, list] of [...byFile.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      const month = file.match(/(\d{4}-\d{2})/)?.[1] ?? file;
      box.createDiv({ cls: 'lifelog-ws-month', text: month });
      for (const e of list.sort((a, b) => b.time.localeCompare(a.time))) {
        const row = box.createDiv({ cls: 'lifelog-ws-item' });
        const head = row.createDiv({ cls: 'lifelog-ws-item-meta' });
        head.createSpan({ cls: 'lifelog-ws-time', text: e.time });
        for (const t of e.tags) {
          head.createSpan({ cls: 'lifelog-ws-tag', text: `#${t}` }).addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.filter = t;
            this.render();
          });
        }
        for (const r of e.rels) head.createSpan({ cls: 'lifelog-ws-rel', text: `${r.name} → ${r.to}` });
        row.createDiv({ cls: 'lifelog-ws-item-title', text: e.text }).addEventListener('click', () => void this.deps.open(file));
      }
    }
    if (rows.length === 0) box.createDiv({ cls: 'lifelog-ws-hint', text: '还没有记录，上面写一条试试' });
  }

  /** 侧栏：Top 标签 / 月度分布 / 24 小时 */
  private renderStats(box: HTMLElement): void {
    const s = stats(this.data);
    box.createDiv({ cls: 'lifelog-ws-head', text: 'Top 标签' });
    for (const [t, n] of s.topTags) {
      const row = box.createDiv({ cls: 'lifelog-ws-side-row' });
      row.createSpan({ text: `#${t}` });
      row.createSpan({ cls: 'lifelog-ws-tree-count', text: String(n) });
      row.addEventListener('click', () => {
        this.filter = t;
        this.render();
      });
    }
    box.createDiv({ cls: 'lifelog-ws-head', text: '月度分布' });
    for (const [m, n] of s.byMonth.slice(-12)) {
      box.createDiv({ cls: 'lifelog-ws-side-row', text: `${m}  ${'▍'.repeat(Math.min(20, n))} ${n}` });
    }
    box.createDiv({ cls: 'lifelog-ws-head', text: '24 小时' });
    const peak = Math.max(...s.byHour, 1);
    box.createDiv({
      cls: 'lifelog-ws-hint',
      text: s.byHour.map((n, h) => (n > 0 && n >= peak / 3 ? pad(h) : '··')).join(' '),
    });
  }
}
