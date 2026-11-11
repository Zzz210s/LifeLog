// 迁移执行：旧格式（一篇笔记一个文件）→ `YYYY-MM.md` 月度文件 → 旧文件归档到 `_归档/`。
import { App, TFile, normalizePath } from 'obsidian';
import { NoteIn, mergeToMonths, worthMigrating } from './merge';

export type MigrateResult = { months: number; entries: number; archived: number; skipped: number; errors: number };

const NL = String.fromCharCode(10);

export function stripFrontmatter(raw: string): string {
  const end = raw.indexOf(NL + '---', 3);
  return end === -1 ? raw : raw.slice(end + 4).replace(new RegExp('^' + NL), '');
}

/** renameFile 不会自动建目录：归档前逐级创建（`_归档/2026/03` 这种） */
async function ensureDir(app: App, dir: string): Promise<void> {
  if (!dir || app.vault.getAbstractFileByPath(dir)) return;
  const parts = dir.split('/');
  let cur = '';
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!app.vault.getAbstractFileByPath(cur)) await app.vault.createFolder(cur).catch(() => undefined);
  }
}

function collect(app: App, root: string): { notes: NoteIn[]; files: TFile[] } {
  const notes: NoteIn[] = [];
  const files: TFile[] = [];
  const prefix = `${root}/笔记/`;
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(prefix)) continue;
    const fm = (app.metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>;
    const rawTags = fm.tags;
    const tags = Array.isArray(rawTags) ? rawTags.map(String) : typeof rawTags === 'string' ? [rawTags] : [];
    const rels = Object.entries(fm)
      .filter(([k, v]) => !k.startsWith('lifelog_') && typeof v === 'string' && String(v).includes('[['))
      .flatMap(([name, v]) => [...String(v).matchAll(/\[\[([^\]|]+)/g)].map((m) => ({ name, to: m[1] })));
    notes.push({
      path: f.path,
      created: typeof fm.lifelog_created === 'string' ? fm.lifelog_created : '',
      body: '',
      tags,
      rels,
    });
    files.push(f);
  }
  return { notes, files };
}

export async function migrateToMonths(
  app: App,
  root: string,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<MigrateResult> {
  const { notes, files } = collect(app, root);
  let errors = 0;

  // 正文必须真读一遍；单篇失败只跳过，不让整批挂掉
  for (let i = 0; i < notes.length; i++) {
    try {
      notes[i].body = stripFrontmatter(await app.vault.cachedRead(files[i]));
    } catch {
      errors += 1;
      notes[i].body = '';
    }
    if (i % 100 === 0) onProgress(i, notes.length);
  }
  onProgress(notes.length, notes.length);

  const usable = notes.filter(worthMigrating);
  const months = mergeToMonths(usable, normalizePath(root));

  const archiveDir = normalizePath(`${root}/_归档`);
  if (!app.vault.getAbstractFileByPath(archiveDir)) await app.vault.createFolder(archiveDir).catch(() => undefined);

  for (const m of months) {
    const exist = app.vault.getAbstractFileByPath(m.path);
    if (exist instanceof TFile) await app.vault.modify(exist, m.content);
    else await app.vault.create(m.path, m.content);
  }

  // 旧文件归档（可回滚、可重入）：目标已存在就跳过，每 200 个回报一次
  let archived = 0;
  const bodyPrefix = `${root}/笔记/`.length;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const target = normalizePath(`${archiveDir}/${f.path.slice(bodyPrefix)}`);
    if (app.vault.getAbstractFileByPath(target)) continue;
    await ensureDir(app, target.split('/').slice(0, -1).join('/'));
    try {
      await app.fileManager.renameFile(f, target);
      archived += 1;
    } catch {
      errors += 1;
    }
    if (i % 200 === 0) onProgress(i, files.length);
  }

  return { months: months.length, entries: usable.length, archived, skipped: notes.length - usable.length, errors };
}
