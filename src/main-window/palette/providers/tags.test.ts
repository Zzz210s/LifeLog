/**
 * 标签 provider 测试:路径打分(前缀档)、计数装饰、空查询按路径序、Enter 语义的载荷(path)。
 */
import { describe, expect, it, vi } from 'vitest';
import { PATH_BOOST } from '../../../shared/fuzzy-score';
import type { TagCount } from '../../../shared/types';
import { createTagProvider, tagDecorations, tagItems } from './tags';

const tag = (path: string, subtree: number, self = subtree): TagCount => ({
  id: path.length,
  path,
  depth: path.split('/').length - 1,
  sort_order: 0,
  self_count: self,
  subtree_count: subtree,
});

describe('tags provider:打分与排序', () => {
  it('空查询:按路径序全量返回,不预置分数', () => {
    const items = tagItems([tag('工作/项目A', 3), tag('生活', 1), tag('工作', 4)], '');
    expect(items.map((i) => i.label)).toEqual(['工作', '工作/项目A', '生活']);
    expect(items[0].score).toBeUndefined();
  });

  it('有查询:路径命中用 PATH_BOOST 档并带高亮位置;未命中不出现', () => {
    const items = tagItems([tag('工作/项目A', 3), tag('生活', 1)], '项目');
    expect(items.map((i) => i.label)).toEqual(['工作/项目A']);
    expect(items[0].score!).toBeGreaterThanOrEqual(PATH_BOOST);
    expect(items[0].positions!.length).toBeGreaterThan(0);
  });

  it('item id 就是标签路径(Enter 直接把它加进筛选,含子级)', () => {
    expect(tagItems([tag('工作/项目A', 3)], '')[0].id).toBe('工作/项目A');
  });
});

describe('tags provider:行内 md 标签名(T1 收尾)', () => {
  const RAW = '地点/[郴](chēn)州市';

  it('有查询:行文案是纯文本,高亮下标重定位到纯文本,id 仍是原始路径', () => {
    const items = tagItems([tag(RAW, 1)], '郴');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('地点/郴州市');
    expect(items[0].positions).toEqual([3]);
    expect(items[0].id).toBe(RAW);
  });

  it('空查询同样只摆纯文本文案(候选里不出现 md 源码)', () => {
    expect(tagItems([tag(RAW, 1)], '')[0].label).toBe('地点/郴州市');
  });

  it('命中落在被去掉的语法符号上时 positions 退化为空(不高亮,不标错位)', () => {
    const items = tagItems([tag(RAW, 1)], '[');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('地点/郴州市');
    expect(items[0].positions).toEqual([]);
  });
});

describe('tags provider:计数装饰', () => {
  it('右侧副文本是含子级计数', () => {
    const deco = tagDecorations([tag('工作', 4), tag('生活', 1)]);
    expect(deco['工作'].detail).toBe('4 条');
    expect(deco['生活'].detail).toBe('1 条');
  });
});

describe('tags provider:注册表条目', () => {
  it('前缀 # = 标签 provider,getItems 接 list_tags', async () => {
    const listTags = vi.fn(async () => [tag('工作', 4)]);
    const p = createTagProvider({ listTags });
    expect(p.prefix).toBe('#');
    expect(p.id).toBe('tags');
    const items = await p.getItems('工');
    expect(listTags).toHaveBeenCalledTimes(1);
    expect(items.map((i) => i.label)).toEqual(['工作']);
  });
});
