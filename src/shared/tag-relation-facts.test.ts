import { describe, expect, it } from 'vitest';
import {
  MAX_RELATION_CHIPS,
  relationLabel,
  relationPlan,
  relationValue,
  relationValueTip,
  tagFactsLines,
  tagFactsRows,
  uniqueRelationValues,
} from './tag-relation-facts';
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

// 2026-10-06 改口径(用户原话:「国籍 → 中国大陆」变成「中国大陆」):行内只显示值
 describe('relationValue:行内只显示值', () => {
  it('只给目标标签名,不含箭头也不含属性名', () => {
    expect(relationValue(rel('中国大陆', '国籍'))).toBe('中国大陆');
    expect(relationValue(rel('中国大陆', '国籍'))).not.toContain('→');
    expect(relationValue(rel('中国大陆', '国籍'))).not.toContain('国籍');
    expect(relationValue(rel('日本'))).toBe('日本');
  });

  it('目标名的行内 md 剥成纯文本(带链接 / 星号 / 代理对)', () => {
    expect(relationValue(rel('[日本](日出之国)', '国籍'))).toBe('日本');
    expect(relationValue(rel('**中国大陆**', '国籍'))).toBe('中国大陆');
    expect(relationValue(rel('[𠀀国](日出之国)'))).toBe('𠀀国');
  });
});

describe('relationValueTip:悬停值给属性名', () => {
  it('有属性名给属性名(剥 md),无属性名给空串(调用方据此不挂 data-tip)', () => {
    expect(relationValueTip(rel('中国大陆', '国籍'))).toBe('国籍');
    expect(relationValueTip(rel('中国大陆', '**出生地**'))).toBe('出生地');
    expect(relationValueTip(rel('所在'))).toBe('');
  });
});

describe('uniqueRelationValues:同值多属性行内去重', () => {
  it('同目标值的多条关系只留第一条(属性名跟着第一条走)', () => {
    const rels = [rel('中国大陆', '国籍'), rel('中国大陆', '出生地'), rel('日本', '国籍')];
    expect(uniqueRelationValues(rels).map(relationValue)).toEqual(['中国大陆', '日本']);
    expect(uniqueRelationValues(rels)[0].remark).toBe('国籍');
  });

  it('同值经**显示名**判定(目标名带不带 md 算同一个值)', () => {
    expect(uniqueRelationValues([rel('[日本](日出之国)'), rel('日本')])).toHaveLength(1);
  });

  it('不同目标全部保留,顺序原样;空表给空表', () => {
    expect(uniqueRelationValues([rel('日本'), rel('中国大陆')]).map(relationValue)).toEqual(['日本', '中国大陆']);
    expect(uniqueRelationValues([])).toEqual([]);
  });
});

describe('档案卡片:标题两行 + 一条关系一行', () => {
  it('标题第一行路径(纯文本)、第二行计数(沿用既有口径)', () => {
    expect(tagFactsLines('[作者/冯骥才](作家)', 1, 1)).toEqual(['作者/冯骥才', '本级 1 / 含子级 1']);
  });

  it('每条关系一行:左列属性名、右列值;同值多属性**都列**(卡片不去重)', () => {
    expect(tagFactsRows([rel('中国大陆', '国籍'), rel('中国大陆', '出生地'), rel('日本', '国籍')])).toEqual([
      { label: '国籍', value: '中国大陆' },
      { label: '出生地', value: '中国大陆' },
      { label: '国籍', value: '日本' },
    ]);
  });

  it('边上没有属性名:左列回退显示目标名(R12 不留空行),右列为空', () => {
    expect(tagFactsRows([rel('所在'), rel('中国大陆', '国籍')])).toEqual([
      { label: '所在', value: '' },
      { label: '国籍', value: '中国大陆' },
    ]);
    expect(tagFactsRows([])).toEqual([]);
  });
});
