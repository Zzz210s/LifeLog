// 视图数据源：月度文件（`拾枝/YYYY-MM.md`）+ 旧笔记（一篇一文件，未迁移时也能读）。
import { App, TFile } from 'obsidian';
import { Entry, formatEntry, parseMonthFile } from '../monthly/parse';

export async function loadEntries(app: App, root: string): Promise<Entry[]> {
  const months: Entry[] = [];
  const legacyNotes: Entry[] = [];
  for (const f of app.vault.getMarkdownFiles()) {
    if (!f.path.startsWith(`${root}/`)) continue;
    const isMonth = /\/\d{4}-\d{2}\.md$/.test(f.path);
    const isOldNote = f.path.startsWith(`${root}/笔记/`);
    if (!isMonth && !isOldNote) continue;
    const raw = await app.vault.cachedRead(f);
    if (isMonth) months.push(...parseMonthFile(f.path, raw));
    else legacyNotes.push(...legacy(f, raw));
  }
  // 已迁移过的库只读月度文件，避免旧笔记与新文件重复计数
  return months.length > 0 ? months : legacyNotes;
}

/** 旧格式：一篇笔记 = 一条，时间取 frontmatter 的 lifelog_created */
function legacy(f: TFile, raw: string): Entry[] {
  const body = raw.replace(/^---[\s\S]*?\n---\n?/, '');
  const time = raw.match(/lifelog_created:\s*(\S+ \d{2}:\d{2})/)?.[1]?.slice(-5) ?? '00:00';
  const tags = [...body.matchAll(/(?:^|\s)#([^\s#[\]]+)/g)].map((m) => m[1]);
  const rels = [...raw.matchAll(/([^\s:：]+)::\s*\[\[([^\]|]+)/g)].map((m) => ({ name: m[1], to: m[2] }));
  const text = body.replace(/(?:^|\s)#[^\s#[\]]+/g, '').replace(/\s+/g, ' ').trim();
  return [{ file: f.path, date: '', time, text, tags, rels }];
}

/** 发送：写进 `拾枝/YYYY-MM.md` 的末尾（文件不存在则创建） */
export async function appendEntry(app: App, root: string, text: string): Promise<string> {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const tags = [...text.matchAll(/(?:^|\s)#([^\s#[\]]+)/g)].map((m) => m[1]);
  const rels = [...text.matchAll(/([^\s:：]+)::\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => ({ name: m[1], to: m[2] }));
  const body = text
    .replace(/([^\s:：]+)::\s*\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[[^\]]*\]\]/g, (m) => m)
    .replace(/(?:^|\s)#[^\s#[\]]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const line = formatEntry(time, body, tags, rels);
  const path = `${root}/${month}.md`;
  const exist = app.vault.getAbstractFileByPath(path);
  if (exist instanceof TFile) await app.vault.append(exist, `\n${line}\n`);
  else await app.vault.create(path, `# ${month}\n\n${line}\n`);
  return line;
}
