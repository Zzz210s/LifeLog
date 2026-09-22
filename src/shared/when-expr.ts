/**
 * `when` 表达式内核:把「显隐/启用/勾选」从组件分支变成可求值的数据。
 * 纯函数、无 IO、无 React 依赖。封闭 AST 只有 defined/not/equals/and/or 五种节点,
 * 恒真恒假用空 and([])/or([]) 表示(即 TRUE/FALSE 两个单例,归一化的产物)。
 * 文本层(解析/序列化)在 when-parse.ts,公开入口(deserialize/validate)在 when.ts。
 */
import { serialize } from './when-parse';

export type ContextValue = string | number | boolean | null | undefined;

/**
 * `equals` 的值域:排除 undefined(I1/T1 审查)。
 * undefined 与 null 序列化后同为 `null`,`null` 又只与自身相等 —— 二者混用会让
 * `serialize` -> `deserialize` 往返改语义;表达「键缺失」请用 `not(defined(k))`。
 */
export type EqualsValue = Exclude<ContextValue, undefined>;

/** 求值上下文:键 -> 值;缺键一律按未定义处理(getOrDefault 才补声明默认值) */
export interface Context {
  readonly [key: string]: ContextValue;
}

export interface ContextKeyDefinedExpr {
  readonly type: 'defined';
  readonly key: string;
}

export interface ContextKeyEqualsExpr {
  readonly type: 'equals';
  readonly key: string;
  readonly value: EqualsValue;
}

export interface ContextKeyNotExpr {
  readonly type: 'not';
  readonly expr: ContextKeyExpr;
}

export interface ContextKeyAndExpr {
  readonly type: 'and';
  readonly exprs: readonly ContextKeyExpr[];
}

export interface ContextKeyOrExpr {
  readonly type: 'or';
  readonly exprs: readonly ContextKeyExpr[];
}

export type ContextKeyExpr =
  | ContextKeyDefinedExpr
  | ContextKeyEqualsExpr
  | ContextKeyNotExpr
  | ContextKeyAndExpr
  | ContextKeyOrExpr;

/** 恒真(空 and) */
export const TRUE: ContextKeyExpr = Object.freeze({ type: 'and', exprs: Object.freeze([]) });
/** 恒假(空 or) */
export const FALSE: ContextKeyExpr = Object.freeze({ type: 'or', exprs: Object.freeze([]) });

const isEmptyJunction = (e: ContextKeyExpr, kind: 'and' | 'or'): boolean =>
  e.type === kind && e.exprs.length === 0;

export const defined = (key: string): ContextKeyExpr => ({ type: 'defined', key });
export const equals = (key: string, value: EqualsValue): ContextKeyExpr => ({ type: 'equals', key, value });
export const not = (expr: ContextKeyExpr): ContextKeyExpr => normalize({ type: 'not', expr });
export const and = (...exprs: ContextKeyExpr[]): ContextKeyExpr => normalize({ type: 'and', exprs });
export const or = (...exprs: ContextKeyExpr[]): ContextKeyExpr => normalize({ type: 'or', exprs });

/**
 * 归一化:递归简化到规范形态 —— 拍平嵌套的同类 and/or、剔除恒真恒假、按序列化去重、
 * 单元素退化、双重否定抵消、空容器退化为 TRUE/FALSE。幂等。
 */
export function normalize(expr: ContextKeyExpr): ContextKeyExpr {
  switch (expr.type) {
    case 'defined':
    case 'equals':
      return expr;
    case 'not': {
      const inner = normalize(expr.expr);
      if (isEmptyJunction(inner, 'and')) return FALSE;
      if (isEmptyJunction(inner, 'or')) return TRUE;
      return inner.type === 'not' ? inner.expr : { type: 'not', expr: inner };
    }
    case 'and':
    case 'or':
      return normalizeJunction(expr.type, expr.exprs);
  }
}

function normalizeJunction(kind: 'and' | 'or', exprs: readonly ContextKeyExpr[]): ContextKeyExpr {
  const out: ContextKeyExpr[] = [];
  const seen = new Set<string>();
  const push = (e: ContextKeyExpr): void => {
    const key = serialize(e);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  for (const raw of exprs) {
    const e = normalize(raw);
    if (e.type === kind) {
      for (const child of e.exprs) push(child);
      continue;
    }
    // 常量:and 里的假 / or 里的真 -> 整体就是该常量
    if (isEmptyJunction(e, kind === 'and' ? 'or' : 'and')) return kind === 'and' ? FALSE : TRUE;
    push(e);
  }
  if (out.length === 0) return kind === 'and' ? TRUE : FALSE;
  if (out.length === 1) return out[0];
  return kind === 'and' ? { type: 'and', exprs: out } : { type: 'or', exprs: out };
}

export function evaluate(expr: ContextKeyExpr, ctx: Context): boolean {
  switch (expr.type) {
    case 'defined':
      return ctx[expr.key] !== undefined;
    case 'equals':
      return sameValue(ctx[expr.key], expr.value);
    case 'not':
      return !evaluate(expr.expr, ctx);
    case 'and':
      return expr.exprs.every((e) => evaluate(e, ctx));
    case 'or':
      return expr.exprs.some((e) => evaluate(e, ctx));
  }
}

/** 值比较:undefined 只等于 undefined(即永不命中,取值缺失);null 只与 null 相等;其余按字符串宽松匹配(数字键 2 与 '2' 都算命中) */
function sameValue(actual: ContextValue, expected: EqualsValue): boolean {
  if (actual === undefined) return false;
  if (actual === null) return actual === expected;
  return String(actual) === String(expected);
}

/**
 * 上下文键:既是声明(默认值),本身又是 defined 表达式节点,可直接参与 and/or/not。
 * getValue 返回上下文原值(未设置 = undefined);getOrDefault 才补声明默认值。
 */
export class RawContextKey<T extends ContextValue = ContextValue> implements ContextKeyDefinedExpr {
  readonly type = 'defined' as const;

  constructor(
    readonly key: string,
    readonly defaultValue: T,
  ) {}

  getValue(ctx: Context): ContextValue {
    return ctx[this.key];
  }

  getOrDefault(ctx: Context): T {
    const value = ctx[this.key];
    return value === undefined ? this.defaultValue : (value as T);
  }

  isDefined(ctx: Context): boolean {
    return ctx[this.key] !== undefined;
  }

  equals(value: EqualsValue): ContextKeyExpr {
    return equals(this.key, value);
  }

  notEquals(value: EqualsValue): ContextKeyExpr {
    return not(equals(this.key, value));
  }
}
