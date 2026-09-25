/**
 * 上下文键纪律的机检(收 T1 审查遗留 I2/I4):
 * 除 `keys.ts` 与测试文件外,源码里不得出现**裸字符串键名** —— 键只准从 `KEYS` / `CONTEXT` 引用。
 *
 * 扫描的是「键名出现在表达式位置」的形态(函数实参、下标、对象键、赋值),而非
 * 无条件匹配引号字符串:`<Sidebar data-testid="sidebar" />` 这类 HTML 属性与上下文键无关,
 * 不该误报(负控用例把它钉住;正控用例证明扫描器真的会命中违规片段)。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KEYS } from './keys';

/** 唯一允许写字面量的实现文件(键的真源) */
const ALLOWED_FILES = ['src/shared/keys.ts'];

const isTestFile = (file: string): boolean => file.endsWith('.test.ts') || file.endsWith('.test.tsx');

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 键名出现在表达式位置的四种形态 */
function patterns(key: string): RegExp[] {
  const k = escapeRe(key);
  return [
    new RegExp(`\\w+\\(\\s*['"\`]${k}['"\`]`), // 函数实参:equals('sidebar', true)
    new RegExp(`[\\w\\)\\]]\\s*\\[\\s*['"\`]${k}['"\`]\\s*\\]`), // 属性访问:ctx['palette.open']
    new RegExp(`['"\`]${k}['"\`]\\s*:`), // 对象键:{ 'palette.open': true }
    new RegExp(`=\\s*['"\`]${k}['"\`]\\s*[;,)]`), // 赋值/声明:const k = 'sidebar';
  ];
}

/** 该行里的违规键名(无违规返回 null);正控与实扫共用这一个判定 */
function offendingKey(line: string): string | null {
  for (const key of Object.values(KEYS)) {
    if (patterns(key).some((re) => re.test(line))) return key;
  }
  return null;
}

function sourceFiles(): string[] {
  return readdirSync('src', { recursive: true, encoding: 'utf8' })
    .map((p) => `src/${p.replace(/\\/g, '/')}`)
    .filter((p) => /\.tsx?$/.test(p) && !isTestFile(p) && !ALLOWED_FILES.includes(p));
}

describe('keys:裸字符串键名扫描(I4/T1 审查遗留)', () => {
  it('正控:扫描器真的会命中违规片段', () => {
    const bad = [
      "expect(evaluate(equals('sidebar', true))).toBe(true)",
      "const key = 'sortNewest';",
      "const v = ctx['palette.open'];",
      "{ 'editing': true }",
      'defined("sortOldest")',
    ];
    for (const line of bad) expect(offendingKey(line), line).not.toBeNull();
  });

  it('负控:HTML 属性与别名数组不算键字面量', () => {
    expect(offendingKey('<Sidebar data-testid="sidebar" />')).toBeNull();
    expect(offendingKey("className={'sidebar'}")).toBeNull();
    // 别名关键词(设计 §3.7)与上下文键同名但不是键引用
    expect(offendingKey("aliases: ['sidebar'],")).toBeNull();
  });

  it('源码里没有裸字符串键名(keys.ts 与测试文件除外)', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(50);
    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const key = offendingKey(line);
          if (key !== null) hits.push(`${file}:${i + 1} 出现裸键『${key}』:${line.trim()}`);
        });
    }
    expect(hits.join('\n')).toBe('');
  });
});
