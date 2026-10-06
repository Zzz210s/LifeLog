import { describe, expect, it } from 'vitest';
import { MAX_RELATION_CHIPS, relationLabel, relationPlan, tagFactsTitle } from './tag-relation-facts';
import type { RelationRef } from './types';

const rel = (name: string, remark = ''): RelationRef => ({
  toTagId: name.length,
  path: name,
  name,
  remark,
});

describe('relationLabel:备注 → 目标,缺备注回退目标名(R12)', () => {
  it('有备注给箭头,无备注只给目标名', () => {
    expect(relationLabel(rel('国籍', '国别'))).toBe('国别 → 国籍');
    expect(relationLabel(rel('国籍'))).toBe('国籍');
  });

  it('备注与目标里的行内 md 都剥成纯文本', () => {
    expect(relationLabel(rel('[国籍](国别)', '国别'))).toBe('国别 → 国籍');
  });

  // 2026-10-06 修订(迁移 023):属性名存在**边**上(remark 字段),不再是目标标签名字里的 md 备注。
  // 判别力:目标名自带 md 备注 `(日出之国)`,边上的属性名是「国籍」 -> 只能出「国籍 → 日本」。
  it('属性名只认边上的 remark,目标名里的 md 备注不参与显示', () => {
    expect(relationLabel(rel('[日本](日出之国)', '国籍'))).toBe('国籍 → 日本');
    expect(relationLabel(rel('[日本](日出之国)'))).toBe('日本');
  });

  // 判别力:目标名**不**经 tagLabelPlain 时这三条都会露出方括号/星号/链接括号
  it('目标名带链接且无备注:回退纯文本目标名(括号全剥)', () => {
    expect(relationLabel(rel('[国别](国籍)'))).toBe('国别');
  });

  it('目标名含代理对(补充平面汉字)时逐字保留,不乱码不漏字', () => {
    expect(relationLabel(rel('[𠀀国](日出之国)'))).toBe('𠀀国');
  });

  it('备注本体带行内 md 也剥成纯文本', () => {
    expect(relationLabel(rel('国籍', '**国别**'))).toBe('国别 → 国籍');
  });
});

describe('relationPlan:最多 2 个 + `+N`', () => {
  it('0/1/2 个原样显示,不出现 +N', () => {
    expect(relationPlan([])).toEqual({ shown: [], extra: 0 });
    expect(relationPlan(['a'])).toEqual({ shown: ['a'], extra: 0 });
    expect(relationPlan(['a', 'b'])).toEqual({ shown: ['a', 'b'], extra: 0 });
    expect(MAX_RELATION_CHIPS).toBe(2);
  });

  it('超过 2 个:截到 2 个并给出余数', () => {
    expect(relationPlan(['a', 'b', 'c'])).toEqual({ shown: ['a', 'b'], extra: 1 });
    expect(relationPlan(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b'], extra: 3 });
  });

  it('max 可覆盖', () => {
    expect(relationPlan(['a', 'b', 'c'], 1)).toEqual({ shown: ['a'], extra: 2 });
  });
});

describe('悬浮卡片文案', () => {
  it('有关系:两行,第二行列全部(不受行内 2 条上限约束)', () => {
    const text = tagFactsTitle('地点轴/国籍/日本', 3, 7, [
      rel('国籍', '国别'),
      rel('所在'),
      rel('产地'),
    ]);
    expect(text.split('\n')).toEqual([
      '地点轴/国籍/日本(本级 3 / 含子级 7)',
      '关系：国别 → 国籍、所在、产地',
    ]);
  });

  it('无关系:只有路径与计数行', () => {
    expect(tagFactsTitle('工作', 0, 0, [])).toBe('工作(本级 0 / 含子级 0)');
    expect(tagFactsTitle('中国', 1, 2, [])).not.toContain('关系');
  });
});
