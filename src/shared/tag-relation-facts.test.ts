import { describe, expect, it } from 'vitest';
import {
  MAX_RELATION_CHIPS,
  relationLabel,
  relationPlan,
  relationValue,
  relationValueTip,
  tagFactsRows,
  tagLeafName,
  uniqueRelationValues,
} from './tag-relation-facts';
import type { RelationRef } from './types';

/** 造一条关系线:v31 名字在**点**上(`nameText`,无名字线为空串),`name` 是被引用点末段名 */
const rel = (name: string, nameText = ''): RelationRef => ({
  toTagId: name.length,
  path: name,
  name,
  nameId: nameText === '' ? null : 1,
  nameText,
  lineId: 1,
});

describe('relationLabel:名字 → 被引用点,无名字只给值', () => {
  it('relation_label_is_name_then_target:有名字给箭头「名字 → 被引用点」', () => {
    expect(relationLabel(rel('中国大陆', '国籍'))).toBe('国籍 → 中国大陆');
  });

  it('relation_label_without_name_is_value_only:无名字线只给被引用点,不画箭头', () => {
    expect(relationLabel(rel('国籍'))).toBe('国籍');
    expect(relationLabel(rel('国籍'))).not.toContain('→');
  });

  it('名字与被引用点里的行内 md 都剥成纯文本', () => {
    expect(relationLabel(rel('[日本](日出之国)', '国籍'))).toBe('国籍 → 日本');
    expect(relationLabel(rel('[日本](日出之国)', '**出生地**'))).toBe('出生地 → 日本');
  });

  it('被引用点名字里的 md 备注不参与显示(名字只认线上的 nameText)', () => {
    expect(relationLabel(rel('[日本](日出之国)', '国籍'))).toBe('国籍 → 日本');
    expect(relationLabel(rel('[日本](日出之国)'))).toBe('日本');
  });

  it('目标名带链接且无名字:回退纯文本目标名(括号全剥)', () => {
    expect(relationLabel(rel('[国别](国籍)'))).toBe('国别');
  });

  it('名字与被引用点含代理对(补充平面汉字)时逐字保留,不乱码不漏字', () => {
    expect(relationLabel(rel('[𠀀国](日出之国)', '国籍'))).toBe('国籍 → 𠀀国');
  });

  // 迁移期兼容:v30 的形状(名字在边上的 `remark`)仍能读出名字;T4.2/T4.3 迁完夹具后此回退删除。
  it('迁移期回退:v30 的 `remark` 也能当名字读出', () => {
    const legacy: RelationRef = { toTagId: 9, path: '地点轴/中国大陆', name: '中国大陆', remark: '国籍' };
    expect(relationLabel(legacy)).toBe('国籍 → 中国大陆');
    expect(relationValueTip(legacy)).toBe('国籍');
  });

  it('迁移期去重:v30 形状没有 `nameText`,退回按值去重(与 v30 逐字相同)', () => {
    const a: RelationRef = { toTagId: 9, path: '地点轴/中国大陆', name: '中国大陆', remark: '国籍' };
    const b: RelationRef = { toTagId: 9, path: '地点轴/中国大陆', name: '中国大陆', remark: '出生地' };
    expect(uniqueRelationValues([a, b])).toHaveLength(1);
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

// 2026-10-06 口径(行内只显示值)+ 2026-10-10 修订(据以改名字点)
describe('relationValue:行内只显示值', () => {
  it('只给被引用点标签名,不含箭头也不含名字', () => {
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

describe('relationValueTip:悬停值给名字', () => {
  it('有名字给名字(剥 md),无名字给空串(调用方据此不挂 data-tip)', () => {
    expect(relationValueTip(rel('中国大陆', '国籍'))).toBe('国籍');
    expect(relationValueTip(rel('中国大陆', '**出生地**'))).toBe('出生地');
    expect(relationValueTip(rel('所在'))).toBe('');
  });
});

describe('uniqueRelationValues:去重键 = 名字 + 值', () => {
  // 判别力:同值不同名(国籍/出生地都指中国大陆)两条都要显示 —— 去掉名字这一维就只剩 1 条。
  it('dedupe_is_by_name_and_value:同值不同名都显示,同名字 + 同值去重', () => {
    const sameValue = [rel('中国大陆', '国籍'), rel('中国大陆', '出生地')];
    expect(uniqueRelationValues(sameValue).map(relationLabel)).toEqual([
      '国籍 → 中国大陆',
      '出生地 → 中国大陆',
    ]);

    const sameName = [rel('中国大陆', '国籍'), rel('中国大陆', '国籍'), rel('日本', '国籍')];
    expect(uniqueRelationValues(sameName).map(relationLabel)).toEqual(['国籍 → 中国大陆', '国籍 → 日本']);
  });

  it('无名字线按值去重(与 v30 逐字相同)', () => {
    const rels = [rel('中国大陆'), rel('中国大陆'), rel('日本')];
    expect(uniqueRelationValues(rels).map(relationValue)).toEqual(['中国大陆', '日本']);
  });

  it('同值经**显示名**判定(目标名带不带 md 算同一个值)', () => {
    expect(uniqueRelationValues([rel('[日本](日出之国)'), rel('日本')])).toHaveLength(1);
  });

  it('不同目标全部保留,顺序原样;空表给空表', () => {
    expect(uniqueRelationValues([rel('日本'), rel('中国大陆')]).map(relationValue)).toEqual(['日本', '中国大陆']);
    expect(uniqueRelationValues([])).toEqual([]);
  });
});

describe('档案卡片:标题一行 + 一条关系一行', () => {
  it('标题 = 标签末段名(纯文本,不带路径前缀)', () => {
    expect(tagLeafName('[作者/冯骥才](作家)')).toBe('冯骥才');
    expect(tagLeafName('时间/日期/2026')).toBe('2026');
    expect(tagLeafName('地点/[郴](chēn)州市')).toBe('郴州市');
    expect(tagLeafName('单段')).toBe('单段');
  });

  it('每条关系一行:左列名字、右列值;同值多名字**都列**(卡片不去重)', () => {
    expect(tagFactsRows([rel('中国大陆', '国籍'), rel('中国大陆', '出生地'), rel('日本', '国籍')])).toEqual([
      { label: '国籍', value: '中国大陆' },
      { label: '出生地', value: '中国大陆' },
      { label: '国籍', value: '日本' },
    ]);
  });

  it('无名字线:左列回退显示目标名(R12 不留空行),右列为空', () => {
    expect(tagFactsRows([rel('所在'), rel('中国大陆', '国籍')])).toEqual([
      { label: '所在', value: '' },
      { label: '国籍', value: '中国大陆' },
    ]);
    expect(tagFactsRows([])).toEqual([]);
  });
});
