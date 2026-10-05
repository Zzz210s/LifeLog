import { describe, expect, it } from 'vitest';
import {
  carryFact,
  carryFacts,
  carryLabel,
  MAX_ROLE_BADGES,
  roleBadges,
  tagFactsTitle,
} from './tag-role-facts';

const ROLES = [
  { path: '地点轴/国籍', name: '国籍' },
  { path: '地点轴/所在', name: '所在' },
];

describe('角色徽章：最多 2 个 + `+N`', () => {
  it('0/1/2 个原样显示,不出现 +N', () => {
    expect(roleBadges([])).toEqual({ badges: [], extra: 0 });
    expect(roleBadges(['国籍'])).toEqual({ badges: ['国籍'], extra: 0 });
    expect(roleBadges(['国籍', '所在'])).toEqual({ badges: ['国籍', '所在'], extra: 0 });
  });

  it('超过 2 个:截到 2 个并给出余数(+N)', () => {
    expect(roleBadges(['国籍', '所在', '要求'])).toEqual({ badges: ['国籍', '所在'], extra: 1 });
    expect(roleBadges(['a', 'b', 'c', 'd', 'e'])).toEqual({ badges: ['a', 'b'], extra: 3 });
    expect(MAX_ROLE_BADGES).toBe(2);
  });

  it('max 可覆盖(测试与将来放宽都用同一个入口)', () => {
    expect(roleBadges(['a', 'b', 'c'], 1)).toEqual({ badges: ['a'], extra: 2 });
  });
});

describe('携带 -> 角色/值', () => {
  it('目标是角色本身:只有角色名,值空', () => {
    expect(carryFact('地点轴/国籍', ROLES)).toEqual({ role: '国籍', value: '' });
  });

  it('目标在角色之下:角色 + 值', () => {
    expect(carryFact('地点轴/国籍/日本', ROLES)).toEqual({ role: '国籍', value: '日本' });
    expect(carryFact('地点轴/所在/中国大陆/四川', ROLES)).toEqual({
      role: '所在',
      value: '中国大陆/四川',
    });
  });

  it('取最近的已登记角色祖先(角色可嵌套)', () => {
    const nested = [...ROLES, { path: '地点轴/国籍/日本', name: '日本' }];
    expect(carryFact('地点轴/国籍/日本/东京', nested)).toEqual({ role: '日本', value: '东京' });
  });

  it('历史行(目标还不是角色)退回目标叶子名', () => {
    expect(carryFact('地点轴/国籍', [])).toEqual({ role: '国籍', value: '' });
    expect(carryFact('时间/出版年份/2008', [])).toEqual({ role: '2008', value: '' });
  });

  it('角色名与路径里的行内 md 都剥成纯文本', () => {
    expect(carryFact('地点轴/**国籍**/日本', [{ path: '地点轴/**国籍**', name: '**国籍**' }])).toEqual({
      role: '国籍',
      value: '日本',
    });
  });

  it('carryLabel:`角色 → 值`;值空时只有角色名', () => {
    expect(carryLabel({ role: '国籍', value: '日本' })).toBe('国籍 → 日本');
    expect(carryLabel({ role: '国籍', value: '' })).toBe('国籍');
  });

  it('carryFacts 保持传入序', () => {
    expect(carryFacts(['地点轴/所在/成都', '地点轴/国籍'], ROLES)).toEqual([
      { role: '所在', value: '成都' },
      { role: '国籍', value: '' },
    ]);
  });
});

describe('悬浮卡片文案', () => {
  it('有角色有携带:三行;路径行沿用既有计数口径', () => {
    const text = tagFactsTitle('地点轴/国籍/日本', 3, 7, ['国籍', '所在'], [
      { role: '国籍', value: '日本' },
    ]);
    expect(text.split('\n')).toEqual([
      '地点轴/国籍/日本(本级 3 / 含子级 7)',
      '角色：国籍、所在',
      '携带：国籍 → 日本',
    ]);
  });

  it('无携带值时不出现携带行', () => {
    const text = tagFactsTitle('中国', 1, 2, ['国籍'], []);
    expect(text).not.toContain('携带');
    expect(text.split('\n')).toEqual(['中国(本级 1 / 含子级 2)', '角色：国籍']);
  });

  it('无角色无携带:只有路径与计数行(与既有 title 一致)', () => {
    expect(tagFactsTitle('工作', 0, 0, [], [])).toBe('工作(本级 0 / 含子级 0)');
  });
});
