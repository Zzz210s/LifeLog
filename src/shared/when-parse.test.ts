import { describe, expect, it } from 'vitest';
import {
  MAX_WHEN_CHARS,
  TRUE,
  WhenExpressionError,
  deserialize,
  equals,
  evaluate,
  serialize,
  validate,
} from './when';

describe('when:文本解析与序列化', () => {
  it('deserialize 支持 defined/equals/!/!=/括号与优先级', () => {
    expect(serialize(deserialize('a'))).toBe('a');
    expect(serialize(deserialize('a && (b || c)'))).toBe('a && (b || c)');
    expect(serialize(deserialize('a && b || c'))).toBe('a && b || c');
    expect(serialize(deserialize('!(a || b)'))).toBe('!(a || b)');
    expect(evaluate(deserialize('a != 1'), { a: 2 })).toBe(true);
    expect(evaluate(deserialize('a != 1'), { a: 1 })).toBe(false);
    expect(evaluate(deserialize('a == 2 && !b'), { a: '2' })).toBe(true);
  });

  it('空串/空白 = 恒真(没有 when 即总是可用)', () => {
    expect(deserialize('')).toBe(TRUE);
    expect(deserialize('   ')).toBe(TRUE);
    expect(validate('')).toBeNull();
    expect(validate('a && !b')).toBeNull();
  });

  it('往返稳定:serialize -> deserialize -> serialize 不变', () => {
    const texts = ['a', '!a', 'a && b || c', 'a && (b || c)', '!(a || b)', 'n == 2'];
    for (const text of texts) {
      const once = serialize(deserialize(text));
      expect(serialize(deserialize(once))).toBe(once);
      expect(once).toBe(text);
    }
  });

  it('值需要引号时加引号:字符串 true/null 与特殊字符不会被读错', () => {
    expect(serialize(equals('k', 'true'))).toBe("k == 'true'");
    expect(serialize(equals('k', 'Ctrl+Shift+P'))).toBe("k == 'Ctrl+Shift+P'");
    expect(serialize(equals('k', null))).toBe('k == null');
    expect(deserialize("k == 'true'")).toEqual(equals('k', 'true'));
    expect(deserialize('k == true')).toEqual(equals('k', true));
    expect(deserialize(serialize(equals('k', 'a b')))).toEqual(equals('k', 'a b'));
    expect(deserialize("k == '工作/项目A'")).toEqual(equals('k', '工作/项目A'));
  });

  it('非法表达式:缺右括号报中文错误并带 0 基 offset', () => {
    const err = validate('(a && b');
    expect(err).not.toBeNull();
    expect(err?.message).toBe('第 8 个字符处:缺少右括号「)」');
    expect(err?.offset).toBe(7);
  });

  it('非法表达式:多余的输入 / 单等号 / 悬空运算符', () => {
    expect(validate('a b')?.message).toBe('第 3 个字符处:多余的输入');
    expect(validate('a b')?.offset).toBe(2);
    expect(validate('a = 1')?.message).toContain('比较要写成「==」');
    expect(validate('a &&')?.message).toContain('这里需要一个键名');
    expect(validate('a ==')?.message).toContain('缺少比较的值');
  });

  it('超长表达式在 offset 0 报错(码点计数,与后端 chars() 同口径)', () => {
    const err = validate('a'.repeat(MAX_WHEN_CHARS + 1));
    expect(err?.offset).toBe(0);
    expect(err?.message).toContain(`最多 ${MAX_WHEN_CHARS} 字符`);
  });

  it('deserialize 非法输入抛 WhenExpressionError(reason + offset)', () => {
    let caught: unknown;
    try {
      deserialize('(a');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(WhenExpressionError);
    const err = caught as WhenExpressionError;
    expect(err.reason).toContain('缺少右括号');
    expect(err.offset).toBe(2);
    expect(err.message).toBe('第 3 个字符处:缺少右括号「)」');
  });
});

