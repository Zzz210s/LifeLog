/**
 * 统一实体池(计划 T3.2)的纯函数用例:① `#` 池 = 树内闭包 ② `[[ ]]` 池 = 全部实体
 * ③ 树内 / 树外徽标文案。池的两路数据仍是既有 IPC 契约,这里只喂形状。
 */
import { describe, expect, it } from 'vitest';
import type { NoteTitle, TagCount } from './types';
import { entityBadge, isInTree, mergeEntityPool, treePool } from './entity-pool';

const tag = (id: number, path: string, self = 0, subtree = 0): TagCount => ({
  id,
  path,
  depth: path.split('/').length - 1,
  sort_order: 0,
  self_count: self,
  subtree_count: subtree,
});

const title = (id: number, name: string): NoteTitle => ({ id, title: name });

describe('实体池:树内闭包(用例 ①)', () => {
  it('hash_pool_is_tree_closure:树内实体一个不少,零引用的中间祖先也在池里', () => {
    // 真库形态:被引用的叶(self_count>0) + 只有 child 入边的自动中间节点(self_count=0)
    const rows = [tag(1010000001, '工作', 2, 2), tag(1010000002, '工作/项目A', 0, 0)];
    const pool = treePool(rows);
    expect(pool.map((e) => e.id)).toEqual([1010000001, 1010000002]);
    expect(pool.every(isInTree)).toBe(true);
    // 反例(变异自证):按裸「被引用」过滤会漏掉只有 child 入边的祖先 -> 池比闭包小
    expect(rows.filter((r) => r.self_count > 0).length).toBe(1);
    expect(pool.length).not.toBe(rows.filter((r) => r.self_count > 0).length);
  });

  it('树内行一律带路径,名字取路径末段', () => {
    expect(treePool([tag(7, '追番/日漫')])).toEqual([{ id: 7, name: '日漫', path: '追番/日漫' }]);
  });
});

describe('实体池:全部实体(用例 ②)', () => {
  it('link_pool_is_all_entities:全部实体都在池里,树外实体的 path 为 null', () => {
    const titles = [title(1, '买牛奶'), title(2, '工作'), title(3, '购物清单')];
    const tree = [tag(2, '工作')];
    const pool = mergeEntityPool(titles, tree);
    expect(pool.map((e) => e.id)).toEqual([1, 2, 3]); // 实体总数一份不多不少
    expect(pool.filter(isInTree).map((e) => e.id)).toEqual([2]); // 树内子集
    expect(pool.find((e) => e.id === 2)).toEqual({ id: 2, name: '工作', path: '工作' });
    expect(pool.find((e) => e.id === 1)).toEqual({ id: 1, name: '买牛奶', path: null });
  });

  it('骨架(complete_notes)缺行时,树内行仍进池(并集不丢)', () => {
    const pool = mergeEntityPool([title(1, '买牛奶')], [tag(9, '地点/家')]);
    expect(pool.map((e) => e.id)).toEqual([1, 9]);
    expect(pool.find((e) => e.id === 9)).toEqual({ id: 9, name: '家', path: '地点/家' });
  });

  it('同 id 不重复(两侧 id 空间同源)', () => {
    expect(mergeEntityPool([title(2, '工作')], [tag(2, '工作')])).toHaveLength(1);
  });
});

describe('实体池:徽标文案(用例 ③)', () => {
  it('entity_badge_says_in_tree_or_out', () => {
    expect(entityBadge(true)).toBe('树内');
    expect(entityBadge(false)).toBe('树外');
  });
});
