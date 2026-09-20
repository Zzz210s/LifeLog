/**
 * 表达式界面的纯函数断言:语法速查表内容、本地长度检查、错误行文案与光标落点。
 * 组件本身(防抖、IPC、折叠区交互)由 CDP 实测取证,这里不渲染 React。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_EXPR_CHARS } from '../../shared/filter-conditions';
import type { ExprCheck } from '../../shared/types';
import { caretOf, charCount, errorLabelOf, localExprError } from './expr-check';
import { EXAMPLES, SYNTAX_HINTS, SYNTAX_NOTES } from './expr-hint';

const check = (patch: Partial<ExprCheck>): ExprCheck => ({
  ok: false,
  message: '',
  position: 0,
  preview: '',
  ...patch,
});

describe('语法速查表', () => {
  it('语法提示覆盖五类形式(日期比较已取消,不再列出)', () => {
    expect(SYNTAX_HINTS.map((h) => h.form)).toEqual([
      '#路径',
      '#=路径',
      '裸词 / "短语"',
      'AND / OR / NOT',
      '( ) 分组',
    ]);
    expect(SYNTAX_HINTS.some((h) => h.form.includes('date'))).toBe(false);
  });

  it('每类形式都给出非空含义,并写明含子级/仅本级与引号约束', () => {
    SYNTAX_HINTS.forEach((h) => expect(h.meaning.trim().length).toBeGreaterThan(0));
    const all = SYNTAX_HINTS.map((h) => h.meaning).join('|');
    expect(all).toContain('含该标签及其全部子级');
    expect(all).toContain('仅本级');
    expect(all).toContain('引号内不能为空');
    expect(all).toContain('&&');
  });

  it('补充说明写明日期比较已取消、单 & | 非法、内嵌标点与 500 字上限', () => {
    const notes = SYNTAX_NOTES.join('|');
    expect(notes).toContain('单个 & 或 | 不是运算符');
    expect(notes).toContain('&&');
    expect(notes).toContain('缺少操作数');
    expect(notes).toContain('引号');
    expect(notes).toContain('·');
    expect(notes).toContain(String(MAX_EXPR_CHARS));
    expect(notes).toContain('日期比较已取消');
  });

  /**
   * 速查表对 a&b 的说法必须与共享向量一致 —— 同一份向量的 expr 条目由 Rust 侧喂给
   * 真源 expr::validate(src-tauri/src/filter_fixtures_tests.rs),不是文案自证。
   */
  it('a&b / a|b 非法的说法与共享向量一致(向量由后端 expr::validate 执行)', () => {
    const cases = JSON.parse(
      readFileSync(new URL('../../../fixtures/filter-conditions.json', import.meta.url), 'utf8'),
    ) as Array<{ kind: string; src?: string; valid?: boolean }>;
    const validOf = (src: string): boolean | undefined =>
      cases.find((c) => c.kind === 'expr' && c.src === src)?.valid;
    expect(validOf('a&b')).toBe(false);
    expect(validOf('a|b')).toBe(false);
    expect(validOf('a&&b')).toBe(true);
  });

  it('示例里不再有日期算子(date>= 现已由后端报中文错)', () => {
    EXAMPLES.forEach((e) => expect(e).not.toContain('date'));
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(3);
    EXAMPLES.forEach((e) => expect(e.trim().length).toBeGreaterThan(0));
  });
});

describe('本地长度检查(唯一的前端校验)', () => {
  it('上限 500 字符:不超限放行,超限给中文提示', () => {
    expect(localExprError('x'.repeat(MAX_EXPR_CHARS))).toBeNull();
    expect(localExprError('x'.repeat(MAX_EXPR_CHARS + 1))).toBe('表达式最多 500 字符');
  });

  it('按码点计数(与 Rust chars().count() 同口径)', () => {
    // 用 BMP 外字符(UTF-16 代理对)证明按码点而非码元计数;\u{20000} 是无需直写生僻字的写法
    const astral = '\u{20000}'.repeat(MAX_EXPR_CHARS + 1);
    expect(charCount(astral)).toBe(MAX_EXPR_CHARS + 1);
    expect(localExprError(astral)).toBe('表达式最多 500 字符');
  });

  it('空白输入不算超限', () => {
    expect(localExprError('   ')).toBeNull();
  });
});

describe('错误行文案与光标落点', () => {
  it('串内错误:0 起下标 +1 显示为第 N 个字符', () => {
    const text = '#工作 AND OR #生活';
    const c = check({ message: '缺少操作数', position: 8 });
    expect(errorLabelOf(c, text)).toBe('第 9 个字符:缺少操作数');
    expect(caretOf(c, text)).toBe(8);
  });

  it('末尾错误显示为「表达式末尾:原因」,不编造输入串里不存在的字符序号', () => {
    const c = check({ message: '缺少操作数', position: 7 });
    expect(errorLabelOf(c, '#工作 AND')).toBe('表达式末尾:缺少操作数');
    expect(caretOf(c, '#工作 AND')).toBe(7); // 光标落在末尾,不越界
  });

  it('末尾错误在 position 超出字符数时也不越界(同样是末尾文案)', () => {
    const c = check({ message: '缺少右括号', position: 9 });
    expect(errorLabelOf(c, '#工作 AND')).toBe('表达式末尾:缺少右括号');
    expect(caretOf(c, '#工作 AND')).toBe(7);
  });

  it('空文本只给原因,不显示第 0 个字符', () => {
    expect(errorLabelOf(check({ message: '表达式为空' }), '')).toBe('表达式为空');
    expect(caretOf(check({ message: '表达式为空' }), '')).toBe(0);
  });
});
