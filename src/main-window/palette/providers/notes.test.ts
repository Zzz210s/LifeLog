/**
 * 笔记 provider 测试:标题 > 正文 > 标签三档、命中位置只在标题档、硬截 200、
 * ≥2 字且本地无高分时才追加一次 FTS 查询。
 */
import { describe, expect, it, vi } from 'vitest';
import { LABEL_MATCH_BOOST, LABEL_PREFIX_BOOST, PATH_BOOST } from '../../../shared/fuzzy-score';
import type { Note } from '../../../shared/types';
import {
  NOTES_CANDIDATE_LIMIT,
  createNoteProvider,
  noteDetail,
  noteItems,
  noteTitle,
  scoreNote,
} from './notes';

const note = (id: number, content: string, tags: string[] = []): Note => ({
  id,
  content,
  tags,
  created_at: '2026-09-22 10:00:00',
});

describe('notes provider:标题提取与详情', () => {
  it('标题 = 首个非空行(空正文退化空串)', () => {
    expect(noteTitle('\n\n  买牛奶  \n第二行')).toBe('买牛奶');
    expect(noteTitle('只有一行')).toBe('只有一行');
    expect(noteTitle('   ')).toBe('');
  });

  it('详情 = 日期 + 最多 3 个标签;无标签只有日期', () => {
    expect(noteDetail(note(1, 'a', ['工作', '生活', 'x', 'y']))).toBe('2026-09-22 · #工作 #生活 #x');
    expect(noteDetail(note(1, 'a'))).toBe('2026-09-22');
  });
});

describe('notes provider:三档打分', () => {
  it('标题命中 >= PATH_BOOST 且带命中位置;正文命中落 LABEL_PREFIX_BOOST 档且无位置', () => {
    const titleHit = scoreNote('牛奶', note(1, '买牛奶\n去超市'));
    expect(titleHit!.score).toBeGreaterThanOrEqual(PATH_BOOST);
    expect(titleHit!.positions.length).toBeGreaterThan(0);

    const bodyHit = scoreNote('超市', note(1, '买牛奶\n去超市'));
    expect(bodyHit!.score).toBeGreaterThanOrEqual(LABEL_PREFIX_BOOST);
    expect(bodyHit!.score).toBeLessThan(PATH_BOOST);
    expect(bodyHit!.positions).toEqual([]);
  });

  it('标签命中落最低档;三档顺序严格递减', () => {
    const tagHit = scoreNote('工作', note(1, '今天很累', ['工作/项目A']));
    expect(tagHit!.score).toBeGreaterThanOrEqual(LABEL_MATCH_BOOST);
    expect(tagHit!.score).toBeLessThan(LABEL_PREFIX_BOOST);
  });

  it('未命中返回 null(不产生 0 分行)', () => {
    expect(scoreNote('zzz', note(1, '买牛奶', ['生活']))).toBeNull();
  });
});

describe('notes provider:列表与硬截', () => {
  const many = Array.from({ length: 250 }, (_, i) => note(i + 1, `笔记${i + 1}`));

  it('空查询返回全部候选(不预置分数),按传入顺序', () => {
    const items = noteItems([note(1, 'a'), note(2, 'b')], '');
    expect(items.map((i) => i.id)).toEqual(['1', '2']);
    expect(items[0].score).toBeUndefined();
  });

  it('候选超过 200 条时硬截到 200(T4 复审判:保护责任在 provider)', () => {
    expect(noteItems(many, '').length).toBe(NOTES_CANDIDATE_LIMIT);
    // '记' 命中全部 250 条标题,证明是「硬截」而不是「删到没命中」
    expect(noteItems(many, '记').length).toBe(NOTES_CANDIDATE_LIMIT);
  });

  it('有查询时只留命中项,并按分降序', () => {
    const items = noteItems([note(1, '买牛奶'), note(2, '去超市'), note(3, '牛奶盒')], '牛奶');
    expect([...items.map((i) => i.id)].sort()).toEqual(['1', '3']);
    expect(items[0].score!).toBeGreaterThanOrEqual(items[1].score!);
  });
});

describe('notes provider:FTS 追加查询', () => {
  const candidates = [note(1, '买牛奶')];

  it('空查询 / 1 字查询不追加 FTS', async () => {
    const search = vi.fn(async () => [] as Note[]);
    const p = createNoteProvider({ getCandidates: async () => candidates, search });
    await p.getItems('');
    await p.getItems('牛');
    expect(search).not.toHaveBeenCalled();
  });

  it('≥2 字但本地已有标题命中时不追加 FTS', async () => {
    const search = vi.fn(async () => [] as Note[]);
    const p = createNoteProvider({ getCandidates: async () => candidates, search });
    const items = await p.getItems('牛奶');
    expect(items.map((i) => i.id)).toEqual(['1']);
    expect(search).not.toHaveBeenCalled();
  });

  it('≥2 字且本地无高分时追加一次 FTS,结果与本地候选并集(按 id 去重)', async () => {
    const search = vi.fn(async (q: string) => (q === '冷门' ? [note(9, '冷门词在正文深处')] : []));
    const p = createNoteProvider({ getCandidates: async () => candidates, search });
    const items = await p.getItems('冷门');
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('冷门');
    expect(items.map((i) => i.id)).toEqual(['9']);

    const both = await p.getItems('牛');
    expect(both.map((i) => i.id)).toEqual(['1']);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('FTS 失败不静默:抛给调用方(错误条在 shell 层)', async () => {
    const p = createNoteProvider({
      getCandidates: async () => candidates,
      search: async () => {
        throw new Error('索引坏了');
      },
    });
    await expect(p.getItems('冷门')).rejects.toThrow(/索引坏了/);
  });

  it('provider 声明空前缀 = 笔记(默认 provider)', () => {
    const p = createNoteProvider({ getCandidates: async () => [], search: async () => [] });
    expect(p.prefix).toBe('');
    expect(p.id).toBe('notes');
  });
});
