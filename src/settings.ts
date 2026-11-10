import { App, PluginSettingTab, Setting } from 'obsidian';
import type LifeLogPlugin from './main';
import { readRecord } from './store/schema';

export class LifeLogSettingTab extends PluginSettingTab {
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
