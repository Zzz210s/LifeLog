/**
 * Task 1(统一输入框 2/3):排序 ×2 + 添加条件三条命令。
 * 覆盖:别名可查、when 恒真、勾选态随 conditions.sort 翻转、run 落到 onPatch / 上抛信号。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callRun, mountAppCommands } from './__fixtures__/app-commands-harness';
import type { AppCommandsHarness } from './__fixtures__/app-commands-harness';
import { findCommand } from '../../shared/commands';
import { CONTEXT, defaultContext } from '../../shared/keys';
import { evaluate } from '../../shared/when';
import type { Context } from '../../shared/when';
import { commandItems } from '../palette/providers/commands';
import { sortContextKeys } from './use-main-palette';

vi.mock('../../shared/api', () => ({ api: {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: async () => true }));

const NEW_IDS = ['sort.newest', 'sort.oldest', 'filter.addCondition'] as const;

let h: AppCommandsHarness;
beforeEach(() => {
  h = mountAppCommands();
});
afterEach(() => {
  h.unmount();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

/** 与 use-main-palette 里同一份映射:条件对象 -> 命令上下文 */
const ctxFor = (sort: 'newest' | 'oldest'): Context => ({
  ...defaultContext(),
  ...sortContextKeys(sort),
});

/** 按查询走真实命令 provider(证明「按别名也能查到」,不是自己写个查找器) */
const byQuery = (query: string, sort: 'newest' | 'oldest' = 'newest'): string[] =>
  commandItems(h.commands().registry, ctxFor(sort), query).map((i) => i.id);

describe('新命令:别名与 when', () => {
  it('三条都在注册表里,且 when 恒真(新老排序下都可见)', () => {
    for (const id of NEW_IDS) {
      expect(h.commands().registry.find(id), id).toBeDefined();
      expect(evaluate(findCommand(id)!.when, ctxFor('newest')), id).toBe(true);
      expect(evaluate(findCommand(id)!.when, ctxFor('oldest')), id).toBe(true);
    }
  });

  it('按别名可查:最新 / sort -> sort.newest,最早 -> sort.oldest,筛选 / 条件 -> filter.addCondition', () => {
    expect(byQuery('最新')).toEqual(['sort.newest']);
    expect(byQuery('sort')).toEqual(['sort.newest']);
    expect(byQuery('最早')).toEqual(['sort.oldest']);
    expect(byQuery('筛选')).toEqual(['filter.addCondition']);
    expect(byQuery('条件')).toEqual(['filter.addCondition']);
  });

  it('标题两半不受影响:勾选态命令才拆「 / 」,三条新命令标题原样', () => {
    expect(byQuery('最新在前')).toEqual(['sort.newest']);
    expect(byQuery('最早在前')).toEqual(['sort.oldest']);
    expect(byQuery('添加条件')).toEqual(['filter.addCondition']);
  });
});

describe('新命令:勾选态随 conditions.sort 翻转', () => {
  it('toggled 绑定各自键(equals,非裸键)', () => {
    expect(findCommand('sort.newest')?.toggled).toEqual(CONTEXT.sortNewest.equals(true));
    expect(findCommand('sort.oldest')?.toggled).toEqual(CONTEXT.sortOldest.equals(true));
  });

  it('newest / oldest 两个方向互斥翻转', () => {
    const on = (id: string, ctx: Context): boolean => evaluate(findCommand(id)!.toggled!, ctx);
    expect([on('sort.newest', ctxFor('newest')), on('sort.oldest', ctxFor('newest'))]).toEqual([
      true,
      false,
    ]);
    expect([on('sort.newest', ctxFor('oldest')), on('sort.oldest', ctxFor('oldest'))]).toEqual([
      false,
      true,
    ]);
  });
});

describe('新命令:run', () => {
  it('sort.newest / sort.oldest 把排序补丁交给 onPatch', async () => {
    await callRun(h, 'sort.oldest');
    expect(h.onPatch).toHaveBeenLastCalledWith({ sort: 'oldest' });
    await callRun(h, 'sort.newest');
    expect(h.onPatch).toHaveBeenLastCalledWith({ sort: 'newest' });
    expect(h.onPatch).toHaveBeenCalledTimes(2);
  });

  it('filter.addCondition 上抛「打开菜单」信号(初始为假)', async () => {
    expect(h.commands().addConditionOpen).toBe(false);
    await callRun(h, 'filter.addCondition');
    expect(h.commands().addConditionOpen).toBe(true);
  });
});
