import { describe, expect, it } from 'vitest';
import {
  FALSE,
  RawContextKey,
  TRUE,
  and,
  defined,
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
    expect(evaluate(equals('tab.count', 2), { 'tab.count': 2 })).toBe(true);
    expect(evaluate(equals('tab.count', 2), { 'tab.count': '2' })).toBe(true);
    expect(evaluate(equals('tab.count', 2), { 'tab.count': 3 })).toBe(false);
    expect(evaluate(equals('tab.count', 2), {})).toBe(false);
    expect(evaluate(equals('sidebar', true), { sidebar: 'true' })).toBe(true);
    expect(evaluate(equals('sidebar', false), { sidebar: false })).toBe(true);
    expect(evaluate(equals('note.selected', null), { 'note.selected': null })).toBe(true);
  });

  it('逻辑组合按上下文求值', () => {
    const ctx: Context = { sidebar: true, editing: false, 'tab.count': 3 };
    expect(evaluate(and(defined('sidebar'), not(equals('editing', true))), ctx)).toBe(true);
    expect(evaluate(or(equals('tab.count', 1), equals('tab.count', 3)), ctx)).toBe(true);
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
    expect(evaluate(defined('tab.count'), ctx)).toBe(true);
    expect(evaluate(CONTEXT.sidebar.notEquals(false), ctx)).toBe(true);
    expect(CONTEXT.paletteOpen.getOrDefault({})).toBe(false);
  });
});
