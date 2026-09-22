/**
 * `when` 表达式公开入口:文本解析/校验 + 全部 AST API 的再导出。
 * 组件与命令表统一从本模块 import(keys.ts 也不例外),不直接引内部拆分文件。
 * 表达式语法:键名即 defined;`!x` 取反;`k == 值` / `k != 值`;`&&`、`||` 与括号;空白 = 恒真。
 */
import { parseWhenExpression, serialize } from './when-parse';
import { TRUE, normalize } from './when-expr';
import type { ContextKeyExpr } from './when-expr';

export * from './when-expr';
export { serialize };

export interface WhenError {
  /** 可直接展示的中文错误(含「第 N 个字符处:」前缀) */
  readonly message: string;
  /** 0 基字符下标(与 String.prototype.slice 同口径) */
  readonly offset: number;
}

export class WhenExpressionError extends Error {
  readonly reason: string;
  readonly offset: number;

  constructor(reason: string, offset: number) {
    super(`第 ${offset + 1} 个字符处:${reason}`);
    this.name = 'WhenExpressionError';
    this.reason = reason;
    this.offset = offset;
  }
}

/** 表达式长度上限(码点数,与后端 chars().count() 同口径) */
export const MAX_WHEN_CHARS = 500;

/** 解析存库/命令声明里的 when 文本;空白 = 恒真(没有条件即总是可用) */
export function deserialize(text: string): ContextKeyExpr {
  const src = text ?? '';
  if (src.trim() === '') return TRUE;
  if ([...src].length > MAX_WHEN_CHARS) {
    throw new WhenExpressionError(`表达式最多 ${MAX_WHEN_CHARS} 字符`, 0);
  }
  const parsed = parseWhenExpression(src);
  if (!parsed.ok) throw new WhenExpressionError(parsed.reason, parsed.offset);
  return normalize(parsed.expr);
}

/** 校验文本表达式:合法返回 null,非法返回带 offset 的中文错误(供设置页即时提示) */
export function validate(text: string): WhenError | null {
  try {
    deserialize(text);
    return null;
  } catch (e) {
    if (e instanceof WhenExpressionError) return { message: e.message, offset: e.offset };
    throw e;
  }
}
