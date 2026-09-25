import { describe, expect, it } from 'vitest';
import {
  FALSE,
  RawContextKey,
  TRUE,
  and,
  defined,
  deserialize,
  equals,
  evaluate,
  normalize,
  not,
  or,
  serialize,
} from './when';
import type { Context, ContextValue } from './when';
import { CONTEXT, KEYS, defaultContext } from './keys';

/** 取值计数上下文:证明 and/or 短路时右侧键根本没被读 */
function countingContext(key: string): { ctx: Context; reads: () => number } {
  const ctx: Record<string, ContextValue> = {};
  let reads = 0;
  Object.defineProperty(ctx, key, {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return true;
    },
  });
  return { ctx, reads: () => reads };
}

describe('when:归一化', () => {
  it('and 为假即短路,不再读右侧键', () => {
    const { ctx, reads } = countingContext('x');
    expect(evaluate(and(defined('missing'), defined('x')), ctx)).toBe(false);
    expect(reads()).toBe(0);
  });

  it('or 为真即短路', () => {
    const { ctx, reads } = countingContext('x');
    expect(evaluate(or(defined('x'), defined('missing')), ctx)).toBe(true);
    expect(reads()).toBe(1);
  });

  it('剔除恒真恒假:and(true,x) 退化为 x,or(false,x) 退化为 x', () => {
    expect(serialize(and(defined('a'), TRUE))).toBe('a');
    expect(serialize(or(defined('a'), FALSE))).toBe('a');
    expect(and(defined('a'), FALSE)).toBe(FALSE);
    expect(or(defined('a'), TRUE)).toBe(TRUE);
    expect(and(FALSE, defined('a'), TRUE)).toBe(FALSE);
  });

  it('单元素退化与空容器常量', () => {
    const a = defined('a');
    expect(and(a)).toBe(a);
    expect(or(a)).toBe(a);
    expect(and()).toBe(TRUE);
    expect(or()).toBe(FALSE);
  });

  it('拍平嵌套 and/or 并去重', () => {
    expect(serialize(and(defined('a'), and(defined('b'), defined('c'))))).toBe('a && b && c');
    expect(serialize(or(defined('a'), or(defined('b'), defined('c'))))).toBe('a || b || c');
    expect(serialize(and(defined('a'), defined('a')))).toBe('a');
    expect(serialize(or(defined('a'), defined('a'), defined('b')))).toBe('a || b');
  });

  it('not 归一化:双重否定抵消、常量折叠', () => {
    expect(not(not(defined('a')))).toEqual(defined('a'));
    expect(not(TRUE)).toBe(FALSE);
    expect(not(FALSE)).toBe(TRUE);
    expect(serialize(not(defined('a')))).toBe('!a');
    expect(serialize(not(and(defined('a'), defined('b'))))).toBe('!(a && b)');
  });

  it('归一化幂等', () => {
    const once = normalize(and(defined('a'), and(TRUE, defined('a'), defined('b'))));
    expect(serialize(once)).toBe('a && b');
    expect(serialize(normalize(once))).toBe('a && b');
  });
});

describe('when:求值', () => {
  it('defined:值存在即为真(false/null 也算存在)', () => {
    expect(evaluate(defined('sidebar'), { sidebar: false })).toBe(true);
    expect(evaluate(defined('sidebar'), { sidebar: null })).toBe(true);
    expect(evaluate(defined('sidebar'), {})).toBe(false);
  });

  it('equals:数字键宽松匹配数字与字符串,未命中为假', () => {
    expect(evaluate(equals('n', 2), { n: 2 })).toBe(true);
    expect(evaluate(equals('n', 2), { n: '2' })).toBe(true);
    expect(evaluate(equals('n', 2), { n: 3 })).toBe(false);
    expect(evaluate(equals('n', 2), {})).toBe(false);
    expect(evaluate(equals('sidebar', true), { sidebar: 'true' })).toBe(true);
    expect(evaluate(equals('sidebar', false), { sidebar: false })).toBe(true);
    expect(evaluate(equals('k', null), { k: null })).toBe(true);
    expect(evaluate(equals('k', null), {})).toBe(false);
  });

  it('逻辑组合按上下文求值', () => {
    const ctx: Context = { sidebar: true, editing: false, n: 3 };
    expect(evaluate(and(defined('sidebar'), not(equals('editing', true))), ctx)).toBe(true);
    expect(evaluate(or(equals('n', 1), equals('n', 3)), ctx)).toBe(true);
  });
});

describe('when:RawContextKey 与键声明表', () => {
  it('RawContextKey 本身可当 defined 节点用,空上下文走默认值', () => {
    const key = new RawContextKey<boolean>('panel.open', false);
    expect(key.type).toBe('defined');
    expect(serialize(key)).toBe('panel.open');
    expect(serialize(key.equals(true))).toBe('panel.open == true');
    expect(serialize(key.notEquals(true))).toBe('!panel.open == true');
    expect(evaluate(key, {})).toBe(false);
    expect(key.isDefined({ 'panel.open': false })).toBe(true);
    expect(key.getValue({})).toBeUndefined();
    expect(key.getOrDefault({})).toBe(false);
    expect(evaluate(and(key, not(equals('panel.open', false))), { 'panel.open': true })).toBe(true);
  });

  it('键字符串非空、唯一,导出对象冻结,键实例与字符串一一对应', () => {
    const names = Object.values(KEYS);
    expect(names.length).toBe(5);
    expect(names).toContain('palette.open');
    expect(names).toContain('sortNewest');
    expect(names).toContain('sortOldest');
    expect(names).not.toContain('note.selected');
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.length).toBeGreaterThan(0);
    expect(Object.isFrozen(KEYS)).toBe(true);
    expect(Object.isFrozen(CONTEXT)).toBe(true);
    for (const [name, key] of Object.entries(CONTEXT)) {
      expect(key.key).toBe(KEYS[name as keyof typeof KEYS]);
      expect(key.type).toBe('defined');
    }
  });

  it('defaultContext 铺满全部键的声明默认值', () => {
    const ctx = defaultContext();
    for (const key of Object.values(CONTEXT)) expect(ctx[key.key]).toBe(key.defaultValue);
    expect(evaluate(defined('sortNewest'), ctx)).toBe(true);
    expect(evaluate(CONTEXT.sidebar.notEquals(false), ctx)).toBe(true);
    expect(CONTEXT.paletteOpen.getOrDefault({})).toBe(false);
  });
});

describe('when:I1 equals 值域收窄(T1 审查遗留)', () => {
  it('undefined 不再是合法值:键缺失改用 not(defined(k))', () => {
    // @ts-expect-error I1:equals 值类型已收窄为 Exclude<ContextValue, undefined>
    const illegal = equals('k', undefined);
    expect(illegal).toBeDefined();
    expect(evaluate(not(defined('k')), {})).toBe(true);
    expect(evaluate(not(defined('k')), { k: null })).toBe(false);
  });

  it('收窄后 null 往返不再改语义', () => {
    const ctxs: Context[] = [{}, { k: null }, { k: 'null' }, { k: 0 }, { k: false }, { k: 'v' }];
    for (const value of [null, 0, 1, false, true, 'v', 'true'] as const) {
      const expr = equals('k', value);
      const round = deserialize(serialize(expr));
      for (const ctx of ctxs) {
        expect(evaluate(round, ctx), `${serialize(expr)} @ ${JSON.stringify(ctx)}`).toBe(
          evaluate(expr, ctx),
        );
      }
    }
  });
});

describe('when:I2 布尔键纪律(T1 审查遗留)', () => {
  it('反例:裸键恒真,布尔键必须 equals(true/false)', () => {
    const ctx = defaultContext();
    // 裸键是 defined:sidebar 为 false 时也为真 -> 命令永不隐藏,故禁止
    expect(evaluate(CONTEXT.sidebar, { sidebar: false })).toBe(true);
    expect(evaluate(CONTEXT.sidebar, ctx)).toBe(true);
    expect(evaluate(CONTEXT.sidebar.equals(true), ctx)).toBe(true);
    expect(evaluate(CONTEXT.sidebar.equals(false), ctx)).toBe(false);
    expect(evaluate(CONTEXT.sidebar.equals(false), { sidebar: false })).toBe(true);
  });
});

describe('when:I3 键表范围(T1 审查遗留)', () => {
  it('键表就是这 5 个:note.selected 与标签页时代的两键都已下线', () => {
    expect(KEYS).not.toHaveProperty('noteSelected');
    expect(CONTEXT).not.toHaveProperty('noteSelected');
    const keys = ['sidebar', 'editing', 'palette.open', 'sortNewest', 'sortOldest'];
    expect(Object.values(KEYS)).toEqual(keys);
    expect(Object.keys(CONTEXT)).toEqual(['sidebar', 'editing', 'paletteOpen', 'sortNewest', 'sortOldest']);
  });
});
