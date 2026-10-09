/**
 * 实体 provider(计划 T3.2 用例 ④):命令面板里只剩一个实体 provider 模块 ——
 * `#` 收窄到树内实体、`@` 与默认档取全部实体;原来的 `notes` / `tags` provider 不再注册。
 */
import { describe, expect, it } from 'vitest';
import type { CommandRegistry } from '../../../shared/commands';
import type { EntityCandidate } from '../../../shared/entity-pool';
import { buildAppProviders } from './app-providers';
import { entityItems } from './entities';

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
});
