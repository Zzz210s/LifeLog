import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LABEL_PREFIX_BOOST } from '../fuzzy-score';
import { buildList, type QuickPickItem } from './model';
import {
  createProviderRegistry,
  registerProvider,
  registeredProviders,
  resetProviders,
  resolveProvider,
  type QuickPickProvider,
} from './providers';

const item = (id: string, label: string): QuickPickItem => ({ id, label });

describe('provider 前缀选择', () => {
  beforeEach(() => {
    resetProviders();
    registerProvider({ prefix: '', id: 'notes', getItems: () => [item('n1', '买牛奶')] });
    registerProvider({ prefix: '>', id: 'commands', getItems: () => [item('c1', 'abcde')] });
    registerProvider({ prefix: '#', id: 'tags', getItems: () => [] });
  });

  it('空前缀未命中 => 默认 provider,查询原样传入', () => {
    const hit = resolveProvider('牛奶');
    expect(hit?.provider.id).toBe('notes');
    expect(hit?.query).toBe('牛奶');
  });

  it('输入 >abc => 命令 provider 且 query 为 abc(前缀被剥掉)', () => {
    const hit = resolveProvider('>abc');
    expect(hit?.provider.id).toBe('commands');
    expect(hit?.query).toBe('abc');
  });

  it('空输入 => 默认 provider 且 query 为空', () => {
    const hit = resolveProvider('');
    expect(hit?.provider.id).toBe('notes');
    expect(hit?.query).toBe('');
  });

  it('空前缀默认 provider 只在没有任何前缀命中时兜底', () => {
    expect(resolveProvider('#工')?.provider.id).toBe('tags');
    expect(resolveProvider('#工')?.query).toBe('工');
  });

  it('registeredProviders() 暴露全局注册表(前缀长度降序)', () => {
    expect(registeredProviders().map((p) => p.id)).toEqual(['commands', 'tags', 'notes']);
  });

  it('providers() 返回副本:改返回值动不了内部注册表', () => {
    const snapshot = registeredProviders() as QuickPickProvider[];
    snapshot.length = 0;
    expect(registeredProviders().map((p) => p.id)).toEqual(['commands', 'tags', 'notes']);
  });
});

describe('provider 按前缀长度降序匹配', () => {
  it('长前缀优先:>>x 命中 >> 而不是 >', () => {
    const r = createProviderRegistry();
    r.register({ prefix: '>', id: 'cmd', getItems: () => [] });
    r.register({ prefix: '>>', id: 'deep', getItems: () => [] });
    expect(r.resolve('>>x')).toEqual({ provider: expect.objectContaining({ id: 'deep' }), query: 'x' });
    expect(r.resolve('>x')).toEqual({ provider: expect.objectContaining({ id: 'cmd' }), query: 'x' });
  });

  it('providers() 按前缀长度降序(同长度保持注册顺序)', () => {
    const r = createProviderRegistry();
    r.register({ prefix: '', id: 'default', getItems: () => [] });
    r.register({ prefix: '>', id: 'cmd', getItems: () => [] });
    r.register({ prefix: '#', id: 'tag', getItems: () => [] });
    r.register({ prefix: '>>', id: 'deep', getItems: () => [] });
    expect(r.providers().map((p) => p.id)).toEqual(['deep', 'cmd', 'tag', 'default']);
  });

  it('没有默认 provider 且前缀未命中 => undefined(不硬猜)', () => {
    const r = createProviderRegistry();
    r.register({ prefix: '>', id: 'cmd', getItems: () => [] });
    expect(r.resolve('随便打字')).toBeUndefined();
    expect(r.resolve('>a')?.query).toBe('a');
  });

  it('前缀或 id 重复/为空会抛中文错误', () => {
    const r = createProviderRegistry();
    r.register({ prefix: '>', id: 'a', getItems: () => [] });
    expect(() => r.register({ prefix: '>', id: 'b', getItems: () => [] })).toThrow('前缀重复');
    expect(() => r.register({ prefix: '#', id: 'a', getItems: () => [] })).toThrow('id 重复');
    expect(() => r.register({ prefix: '#', id: '  ', getItems: () => [] })).toThrow('id 不能为空');
  });
});

describe('前缀不参与打分', () => {
  const getItems = vi.fn((_query: string) => [item('c1', 'abcde')]);

  beforeEach(() => {
    getItems.mockClear();
    resetProviders();
    registerProvider({ prefix: '>', id: 'commands', getItems });
  });

  it('getItems 收到剥掉前缀后的查询;打分用该查询,前缀本身不进目标串', () => {
    const hit = resolveProvider('>ab');
    expect(hit).toBeDefined();
    const provider = hit!.provider;
    const items = provider.getItems(hit!.query) as QuickPickItem[];

    // provider 拿到的就是 abc,而不是 >ab
    expect(getItems).toHaveBeenCalledWith('ab');
    expect(items[0].label).toBe('abcde');
    const { rows } = buildList({ items, query: hit!.query, limit: 10 });
    expect(rows).toHaveLength(1);
    // 若把 >ab 当查询,label 里没有 >,只会得到 0 分空列表
    expect(buildList({ items, query: '>ab' }).rows).toEqual([]);
    expect(rows[0].positions).toEqual([0, 1]);
    expect(rows[0].score).toBeGreaterThanOrEqual(LABEL_PREFIX_BOOST);
  });
});
