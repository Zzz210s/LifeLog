import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian';
import { KEY, PointRecord, notePath, readRecord } from './store/schema';
import { parseCapture } from './capture/parse';
import { cooccurrence, neighborsOf, renderBlock, upsertBlock } from './store/cooccur';
import { buildFiles } from './import/map';
import { importFiles, summaryText } from './import/run';
import { parseDump } from './import/sqlite';

type Settings = { root: string; lastId: number };
const DEFAULT: Settings = { root: '拾枝', lastId: 0 };

class CaptureModal extends Modal {
  constructor(app: App, private onSubmit: (text: string) => void) {
    super(app);
  }
  onOpen() {
    const input = this.contentEl.createEl('input', { cls: 'lifelog-capture-input' });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        this.onSubmit(input.value);
        this.close();
      }
    });
    input.focus();
  }
  onClose() {
    this.contentEl.empty();
  }
}

export default class LifeLogPlugin extends Plugin {
  settings: Settings = { ...DEFAULT };

  async onload() {
    this.settings = Object.assign({}, DEFAULT, await this.loadData());
    this.addCommand({ id: 'capture', name: '捕获', callback: () => this.openCapture() });
    this.addCommand({ id: 'init', name: '初始化库', callback: () => void this.initLibrary() });
    this.addCommand({ id: 'cooccur', name: '重建共现区块', callback: () => void this.rebuildCooccurrences() });
    this.addCommand({
      id: 'import',
      name: '导入 lifelog.db 或 dump',
      callback: () => void this.pickImport(),
    });
    this.addSettingTab(new LifeLogSettingTab(this.app, this));
  }

  openCapture() {
    new CaptureModal(this.app, (text) => void this.save(text)).open();
  }

  async save(text: string) {
    const c = parseCapture(text);
    if (!c.body && c.tags.length === 0) return;
    const id = ++this.settings.lastId;
    await this.saveData(this.settings);
    const created = new Date().toISOString().slice(0, 19);
    const title = c.body.slice(0, 40) || c.tags[0] || '未命名';
    const path = normalizePath(notePath(title, created, this.settings.root));
    const head = [
      '---',
      `${KEY.created}: ${created}`,
      c.parent ? `${KEY.parent}: ${c.parent}` : null,
      '---',
      '',
    ].filter((l): l is string => l !== null);
    const tail = `${c.body}${c.tags.map((t) => ` #${t}`).join('')}${c.links.map((l) => ` [[${l}]]`).join('')}`;
    await this.ensureFolder(path);
    await this.app.vault.create(path, [...head, tail, ''].join('\n'));
    new Notice(`已记录 #${id}`);
  }

  async ensureFolder(filePath: string) {
    const dir = filePath.split('/').slice(0, -1).join('/');
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => undefined);
  }

  async initLibrary() {
    const root = normalizePath(this.settings.root);
    for (const sub of ['笔记', '实体', '.lifelog']) {
      const p = `${root}/${sub}`;
      if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.createFolder(p).catch(() => undefined);
    }
    const cfg = `${root}/.lifelog/config.json`;
    if (!this.app.vault.getAbstractFileByPath(cfg)) {
      await this.app.vault.create(cfg, JSON.stringify({ name: root.split('/').pop(), version: 1, nextId: 1 }, null, 2));
    }
    new Notice(`库已初始化：${root}`);
  }

  folderFiles(sub: '笔记' | '实体'): TFile[] {
    return this.app.vault.getMarkdownFiles().filter((f) => f.path.includes(`${this.settings.root}/${sub}/`));
  }

  /** 选一个 .json dump（scripts/dump-db.ts 生成）→ 生成 2134 个文件。 */
  async pickImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const stop = new Notice('导入中…', 0);
      try {
        const dump = parseDump(await file.text());
        const { files, stats } = buildFiles(dump.points, dump.lines, this.settings.root);
        const result = await importFiles(files, {
          exists: (p) => this.app.vault.getAbstractFileByPath(p) !== null,
          ensureFolder: async (d) => {
            if (!this.app.vault.getAbstractFileByPath(d)) await this.app.vault.createFolder(d).catch(() => undefined);
          },
          create: async (p, c) => {
            await this.app.vault.create(p, c);
          },
        });
        stop.hide();
        new Notice(`导入完成：${summaryText(result)}（笔记 ${stats.notes} / 实体 ${stats.entities}）`, 15000);
      } catch (err) {
        stop.hide();
        new Notice(`导入失败：${String(err)}`, 15000);
      }
    };
    input.click();
  }

  /** vault → GraphData：实体节点 + 父子边 + 共现边。 */


  async readRecords(): Promise<PointRecord[]> {
    const files = [...this.folderFiles('笔记'), ...this.folderFiles('实体')];
    const out: PointRecord[] = [];
    for (const f of files) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      out.push(readRecord(f.path, fm, await this.app.vault.cachedRead(f)));
    }
    return out;
  }

  /** 把「同篇一起出现的实体」写成实体笔记里的受管区块 —— 原生关系图据此画出实体间直边。 */
  async rebuildCooccurrences() {
    const pairs = cooccurrence(await this.readRecords(), 2);
    const prefix = `${this.settings.root}/实体/`;
    let touched = 0;
    for (const f of this.folderFiles('实体')) {
      const name = f.path.replace(/^.*\/实体\//, '').replace(/\.md$/, '');
      const near = neighborsOf(pairs, name);
      if (near.length === 0) continue;
      const body = await this.app.vault.read(f);
      const next = upsertBlock(body, renderBlock(near, name));
      if (next !== body) {
        await this.app.vault.modify(f, next);
        touched += 1;
      }
    }
    new Notice(`共现区块已更新 ${touched} 个实体（全库 ${pairs.length} 对，路径前缀 ${prefix}）`);
  }
}

class LifeLogSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: LifeLogPlugin) {
    super(app, plugin);
  }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName('库文件夹')
      .setDesc('笔记与实体所在的 vault 内文件夹')
      .addText((t) =>
        t.setValue(this.plugin.settings.root).onChange(async (v) => {
          this.plugin.settings.root = v.trim() || '拾枝';
          await this.plugin.saveData(this.plugin.settings);
        }),
      );
    const info = this.containerEl.createEl('p');
    const notes = this.plugin.folderFiles('笔记');
    const entities = this.plugin.folderFiles('实体');
    const sample = entities
      .slice(0, 3)
      .map((f) => readRecord(f.path, this.app.metadataCache.getFileCache(f)?.frontmatter, '').id);
    info.setText(`笔记 ${notes.length} 篇 / 实体 ${entities.length} 个（id 抽样 ${sample.join(', ') || '无'}）`);
  }
}
