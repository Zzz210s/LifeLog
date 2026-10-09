/**
 * 实体 provider(计划 T3.2 用例 ④):命令面板里只剩一个实体 provider 模块 ——
 * `#` 收窄到树内实体、`@` 与默认档取全部实体;原来的 `notes` / `tags` provider 不再注册。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CommandRegistry } from '../../../shared/commands';
import type { EntityCandidate } from '../../../shared/entity-pool';
import { buildAppProviders } from './app-providers';
import { entityItems, tagDecorations } from './entities';

const pool: readonly EntityCandidate[] = [
  { id: 1, name: '买牛奶', path: null },
  { id: 2, name: '工作', path: '工作' },
  { id: 3, name: '购物清单', path: null },
];

const fakeCommands = { list: () => [] } as unknown as CommandRegistry;

const providers = () =>
  buildAppProviders({
    registry: fakeCommands,
    getContext: () => ({}) as never,
    entityPool: { current: async () => pool },
    getVersion: () => 0,
    tagsRef: { current: [] },
  });

describe('实体 provider:一个模块,三种前缀(用例 ④)', () => {
  it('palette_has_single_entity_provider:只剩实体 provider,没有 notes / tags', () => {
    const ids = providers().providers().map((p) => p.id);
    expect(ids.filter((id) => id.startsWith('entities')).sort()).toEqual([
      'entities',
      'entities-open',
      'entities-tree',
    ]);
    expect(ids).not.toContain('notes');
    expect(ids).not.toContain('tags');
  });

  it('`#` 池 = 树内实体(行 id 是路径);`@` 池 = 全部实体(行 id 是实体 id)', async () => {
    const registry = providers();
    const tree = await registry.resolve('#')!.provider.getItems('');
    expect(tree.map((i) => i.id)).toEqual(['工作']);
    expect(tree.map((i) => i.label)).toEqual(['工作']);

    const all = await registry.resolve('@')!.provider.getItems('');
    expect(all.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(all.map((i) => i.label)).toEqual(['买牛奶', '工作', '购物清单']);
  });

  it('有查询按共享打分器排序,未命中不出现', () => {
    expect(entityItems(pool, '牛奶', false).map((i) => i.label)).toEqual(['买牛奶']);
    expect(entityItems(pool, 'zzz', false)).toEqual([]);
    // 树内收窄:查询命中树外实体也不出现
    expect(entityItems(pool, '牛奶', true)).toEqual([]);
  });

  it('legacy_note_tag_modules_removed:旧的笔记/标签 provider 与候选池模块已删', () => {
    const path = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
    expect(existsSync(path('./notes.ts'))).toBe(false);
    expect(existsSync(path('./tags.ts'))).toBe(false);
    expect(existsSync(path('../note-candidates.ts'))).toBe(false);
    expect(existsSync(path('../tag-candidates.ts'))).toBe(false);
  });
});

describe('实体 provider:树内 md 标签名(自旧 tags provider 迁入)', () => {
  const RAW = '地点/[郴](chēn)州市';
  const mdPool: readonly EntityCandidate[] = [{ id: 1, name: '郴州市', path: RAW }];

  it('有查询:行文案是纯文本,高亮下标重定位,行 id 仍是原始路径', () => {
    const items = entityItems(mdPool, '郴', true);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('地点/郴州市');
    expect(items[0].positions).toEqual([3]);
    expect(items[0].id).toBe(RAW);
  });

  it('空查询同样只摆纯文本文案(候选里不出现 md 源码)', () => {
    expect(entityItems(mdPool, '', true)[0].label).toBe('地点/郴州市');
  });

  it('命中落在被去掉的语法符号上:positions 退化为空(不高亮,不标错位)', () => {
    expect(entityItems(mdPool, '[', true)[0].positions).toEqual([]);
  });
});

describe('实体 provider:计数装饰(自旧 tags provider 迁入)', () => {
  it('右侧副文本是含子级计数', () => {
    const deco = tagDecorations([
      { id: 1, path: '工作', depth: 0, sort_order: 0, self_count: 4, subtree_count: 4 },
      { id: 2, path: '生活', depth: 0, sort_order: 0, self_count: 1, subtree_count: 1 },
    ]);
    expect(deco['工作'].detail).toBe('4 条');
    expect(deco['生活'].detail).toBe('1 条');
  });
});
