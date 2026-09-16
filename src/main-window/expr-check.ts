/**
 * 表达式校验结果的展示规则(纯函数,便于单测):
 * - 位置口径:后端 `ExprCheck.position` 是 **0 起字符下标**,串内错误只在**展示层** +1 成
 *   「第 N 个字符」(N = 下标 + 1),光标定位用原值(绝不在后端或状态里加 1)。
 * - 末尾错误(`position` 已到文本末尾,如「缺少操作数」「缺少右括号」)不改写成一个
 *   输入串里不存在的「第 N 个字符」,直接显示「表达式末尾:<原因>」;
 *   光标仍落到末尾(下标 = 字符数),文案与光标不会互相打架。
 * - 长度上限是前端**唯一**的本地校验,其余语义一律走 IPC `validate_expr`,前端不做第二套解析器。
 */
import { MAX_EXPR_CHARS } from '../shared/filter-conditions';
import type { ExprCheck } from '../shared/types';

/** 按字符(码点)计数,与 Rust `chars().count()` 同口径 */
export const charCount = (text: string): number => [...text].length;

/** 本地长度检查:超限返回中文提示,合法返回 null(不触 IPC) */
export function localExprError(text: string): string | null {
  return charCount(text) > MAX_EXPR_CHARS ? `表达式最多 ${MAX_EXPR_CHARS} 字符` : null;
}

/**
 * 错误行文案:串内错误「第 N 个字符:<原因>」,末尾错误「表达式末尾:<原因>」,
 * 空文本只给原因(没有可指的位置)。
 */
export function errorLabelOf(check: ExprCheck, text: string): string {
  const total = charCount(text);
  if (total === 0) return check.message;
  if (check.position >= total) return `表达式末尾:${check.message}`;
  return `第 ${check.position + 1} 个字符:${check.message}`;
}

/** 光标落点(字符下标):末尾错误落在文本末尾,不越界 */
export function caretOf(check: ExprCheck, text: string): number {
  return Math.min(check.position, charCount(text));
}
