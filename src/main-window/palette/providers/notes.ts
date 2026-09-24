/**
 * 笔记 provider(设计 §3.3):候选 = 最近 200 条(调用方分页取回后注入),本地打分三档
 * 「标题 > 正文 > 标签」,输入 ≥2 字且本地无高分命中时追加一次 FTS 查询(`query_notes(keyword)`)。
 *
 * - 打分分层:标题 `PATH_BOOST` / 正文 `LABEL_PREFIX_BOOST` / 标签 `LABEL_MATCH_BOOST`;
 *   命中位置只在标题档给出(正文/标签的下标对标题串无意义,给出去 `<mark>` 会标错)。
 * - **硬截 200**:候选与 FTS 结果合并后一律截到 200 —— 模型不限制候选数,保护责任在 provider
 *   (T4 复审判)。
 * - FTS 失败不吞:抛给调用方,由 shell 层落到主窗错误条。
 */
import { LABEL_MATCH_BOOST, LABEL_PREFIX_BOOST, PATH_BOOST, scoreFuzzy } from '../../../shared/fuzzy-score';
import type { QuickPickItem } from '../../../shared/quickpick/model';
import type { Note } from '../../../shared/types';
import type { RowDecoration } from '../PaletteRow';

export const NOTES_PREFIX = '';
export const NOTES_PROVIDER_ID = 'notes';
/** 本地候选与最终结果的硬上限(设计 §3.3 QUICK_OPEN_LIMIT) */
export const NOTES_CANDIDATE_LIMIT = 200;
/** 追加 FTS 的最小查询长度(1 字本地打分足够,免得每次按键都打库) */
export const NOTES_FTS_MIN_CHARS = 2;

/** 标题 = 首个非空行(笔记首行即标题;空正文给空串) */
export function noteTitle(content: string): string {
  const line = content.split('\n').find((l) => l.trim() !== '');
  return (line ?? '').trim();
}

/** 行右侧副文本:创建日期 + 最多 3 个标签(设计 §3.3) */
export function noteDetail(note: Note): string {
  const date = note.created_at.slice(0, 10);
  const tags = note.tags.slice(0, 3).map((t) => `#${t}`).join(' ');
  return tags === '' ? date : `${date} · ${tags}`;
}

/** 三档打分:标题 > 正文 > 标签;未命中 null */
export function scoreNote(query: string, note: Note): { score: number; positions: number[] } | null {
  const title = noteTitle(note.content);
  // boostTiers:false —— 三档由本 provider 叠加(标题 PATH_BOOST / 正文 LABEL_PREFIX_BOOST /
  // 标签 LABEL_MATCH_BOOST);用默认值会让 scorer 先叠一层档位,把三档压扁成两档。
  const opts = { boostTiers: false } as const;
  const t = scoreFuzzy(query, title, opts);
  if (t.score > 0) return { score: PATH_BOOST + t.score, positions: t.positions };
  const b = scoreFuzzy(query, note.content, opts);
  if (b.score > 0) return { score: LABEL_PREFIX_BOOST + b.score, positions: [] };
  for (const tag of note.tags) {
    const g = scoreFuzzy(query, tag, opts);
    if (g.score > 0) return { score: LABEL_MATCH_BOOST + g.score, positions: [] };
  }
  return null;
}

/** 候选 -> 列表项(空查询不带分数;有查询只留命中项),结果硬截 200 */
export function noteItems(notes: readonly Note[], query: string): QuickPickItem[] {
  const q = query.trim();
  const out: QuickPickItem[] = [];
  for (const note of notes) {
    const label = noteTitle(note.content) || note.content.trim();
    if (q === '') {
      out.push({ id: String(note.id), label });
      continue;
    }
    const hit = scoreNote(q, note);
    if (hit === null) continue;
    out.push({ id: String(note.id), label, score: hit.score, positions: hit.positions });
  }
  if (q !== '') out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return out.slice(0, NOTES_CANDIDATE_LIMIT);
}

/** 笔记行装饰(日期 + 标签),供浮层副文本 */
export function noteDecorations(notes: readonly Note[]): Record<string, RowDecoration> {
  const out: Record<string, RowDecoration> = {};
  for (const note of notes) out[String(note.id)] = { detail: noteDetail(note) };
  return out;
}

/**
 * 按"当前可见的候选行"生成装饰:id -> 笔记 的索引由调用方在取候选/FTS 回包时填充。
 * 用 items(而非全量候选)是为了只给真在列表里的行算副文本。
 */
export function noteDecorationsFor(
  items: readonly QuickPickItem[],
  index: ReadonlyMap<number, Note>,
): Record<string, RowDecoration> {
  const out: Record<string, RowDecoration> = {};
  for (const item of items) {
    const note = index.get(Number(item.id));
    if (note !== undefined) out[item.id] = { detail: noteDetail(note) };
  }
  return out;
}

export interface NoteProviderOptions {
  /** 最近候选(host 分页取回并缓存;provider 不管分页) */
  getCandidates: () => Promise<readonly Note[]>;
  /** FTS 追加查询(host 注入 `query_notes(keyword)`;失败原样抛) */
  search: (query: string) => Promise<readonly Note[]>;
  /** 注册前缀:缺省 `''`(浮层默认 provider),`'@'` 给统一输入框的「打开笔记」 */
  prefix?: string;
}

/** 统一输入框 `@`(打开笔记)的注册前缀:同一份笔记候选、另一个前缀入口 */
export const NOTES_OPEN_PREFIX = '@';
export const NOTES_OPEN_PROVIDER_ID = 'notes-open';

/** 注册表条目(空前缀 = 默认 provider) */
export function createNoteProvider(options: NoteProviderOptions) {
  const getItems = async (query: string): Promise<QuickPickItem[]> => {
    const candidates = await options.getCandidates();
    const local = noteItems(candidates, query);
    const q = query.trim();
    if (q.length < NOTES_FTS_MIN_CHARS) return local;
    // 本地已有标题档命中(高分)就不打库;只有"本地找不到好的"才补一次 FTS
    if (local.some((item) => (item.score ?? 0) >= PATH_BOOST)) return local;
    const extra = await options.search(q);
    const seen = new Set(candidates.map((n) => n.id));
    const merged = [...candidates, ...extra.filter((n) => !seen.has(n.id))];
    return noteItems(merged, query);
  };
  const prefix = options.prefix ?? NOTES_PREFIX;
  return {
    prefix,
    id: prefix === NOTES_PREFIX ? NOTES_PROVIDER_ID : NOTES_OPEN_PROVIDER_ID,
    getItems,
  };
}
