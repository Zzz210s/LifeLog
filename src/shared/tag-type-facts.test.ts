import { describe, expect, it } from 'vitest';
import {
  carryFact,
  carryFacts,
  carryLabel,
  MAX_TYPE_BADGES,
  typeBadgeRefs,
  typeBadges,
  tagFactsTitle,
} from './tag-type-facts';

const TYPES = [
  { path: '地点轴/国籍', name: '国籍' },
  { path: '地点轴/所在', name: '所在' },
];

describe('类型徽章：最多 2 个 + `+N`', () => {
  it('0/1/2 个原样显示,不出现 +N', () => {
    expect(typeBadges([])).toEqual({ badges: [], extra: 0 });
    expect(typeBadges(['国籍'])).toEqual({ badges: ['国籍'], extra: 0 });
    expect(typeBadges(['国籍', '所在'])).toEqual({ badges: ['国籍', '所在'], extra: 0 });
  });

  it('超过 2 个:截到 2 个并给出余数(+N)', () => {
    expect(typeBadges(['国籍', '所在', '要求'])).toEqual({ badges: ['国籍', '所在'], extra: 1 });
    expect(typeBadges(['a', 'b', 'c', 'd', 'e'])).toEqual({ badges: ['a', 'b'], extra: 3 });
    expect(MAX_TYPE_BADGES).toBe(2);
  });

  it('max 可覆盖(测试与将来放宽都用同一个入口)', () => {
    expect(typeBadges(['a', 'b', 'c'], 1)).toEqual({ badges: ['a'], extra: 2 });
  });

  it('typeBadgeRefs 保留 id(同名类型也能拿到不重叠的 key)', () => {
    const chips = [
      { tagId: 7, name: '所在' },
      { tagId: 9, name: '所在' },
    ];
    expect(typeBadgeRefs(chips)).toEqual({ badges: chips, extra: 0 });
    expect(typeBadgeRefs(chips, 1)).toEqual({ badges: [chips[0]], extra: 1 });
  });
});

describe('携带 -> 类型/值', () => {
  it('目标是类型本身:只有类型名,值空', () => {
    expect(carryFact('地点轴/国籍', TYPES)).toEqual({ type: '国籍', value: '' });
  });

  it('目标在类型之下:类型 + 值', () => {
    expect(carryFact('地点轴/国籍/日本', TYPES)).toEqual({ type: '国籍', value: '日本' });
    expect(carryFact('地点轴/所在/中国大陆/四川', TYPES)).toEqual({
      type: '所在',
      value: '中国大陆/四川',
    });
  });

  it('取最近的已登记类型祖先(类型可嵌套)', () => {
    const nested = [...TYPES, { path: '地点轴/国籍/日本', name: '日本' }];
    expect(carryFact('地点轴/国籍/日本/东京', nested)).toEqual({ type: '日本', value: '东京' });
  });

  it('历史行(目标还不是类型)退回目标叶子名', () => {
    expect(carryFact('地点轴/国籍', [])).toEqual({ type: '国籍', value: '' });
    expect(carryFact('时间/出版年份/2008', [])).toEqual({ type: '2008', value: '' });
  });

  it('类型名与路径里的行内 md 都剥成纯文本', () => {
    expect(carryFact('地点轴/**国籍**/日本', [{ path: '地点轴/**国籍**', name: '**国籍**' }])).toEqual({
      type: '国籍',
      value: '日本',
    });
  });

  it('carryLabel:`类型 → 值`;值空时只有类型名', () => {
    expect(carryLabel({ type: '国籍', value: '日本' })).toBe('国籍 → 日本');
    expect(carryLabel({ type: '国籍', value: '' })).toBe('国籍');
  });

  it('carryFacts 保持传入序', () => {
    expect(carryFacts(['地点轴/所在/成都', '地点轴/国籍'], TYPES)).toEqual([
      { type: '所在', value: '成都' },
      { type: '国籍', value: '' },
    ]);
  });
});

describe('悬浮卡片文案', () => {
  it('有类型有携带:三行;路径行沿用既有计数口径', () => {
    const text = tagFactsTitle('地点轴/国籍/日本', 3, 7, ['国籍', '所在'], [
      { type: '国籍', value: '日本' },
    ]);
    expect(text.split('\n')).toEqual([
      '地点轴/国籍/日本(本级 3 / 含子级 7)',
      '类型：国籍、所在',
      '携带：国籍 → 日本',
    ]);
  });

  it('无携带值时不出现携带行', () => {
    const text = tagFactsTitle('中国', 1, 2, ['国籍'], []);
    expect(text).not.toContain('携带');
    expect(text.split('\n')).toEqual(['中国(本级 1 / 含子级 2)', '类型：国籍']);
  });

  it('无类型无携带:只有路径与计数行(与既有 title 一致)', () => {
    expect(tagFactsTitle('工作', 0, 0, [], [])).toBe('工作(本级 0 / 含子级 0)');
  });
});
