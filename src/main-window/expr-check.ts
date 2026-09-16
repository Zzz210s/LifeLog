/**
 * 表达式校验结果的展示规则(纯函数,便于单测):
 * - 位置口径:后端 `ExprCheck.position` 是 **0 起字符下标**,只在**展示层** +1 成
 *   「第 N 个字符」,光标定位用原值(绝不在后端或状态里加 1)。
 * - 末尾错误(`position` 等于字符数,如「缺少操作数」「缺少右括号」)时取最后一个字符的
 *   序号:否则会显示「第 8 个字符」这种输入串里不存在的字符(与 brief 的读数一致)。
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

/** 错误行文案「第 N 个字符:<原因>」;1 个字符都没有时只给原因 */
export function errorLabelOf(check: ExprCheck, text: string): string {
  const n = Math.min(check.position + 1, charCount(text));
  return n >= 1 ? `第 ${n} 个字符:${check.message}` : check.message;
}

/** 光标落点(字符下标):末尾错误落在文本末尾,不越界 */
export function caretOf(check: ExprCheck, text: string): number {
  return Math.min(check.position, charCount(text));
}
