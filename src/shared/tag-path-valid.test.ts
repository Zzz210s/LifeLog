/**
 * T3 共享向量 `fixtures/tag-path-valid.json` 的前端侧断言:逐条喂给真源
 * `isValidTagPath`(md 友好口径)。Rust 侧读同一份文件断言 `tags::validate_tag_path`
 * (见 `src-tauri/src/tag_label_tests.rs`),任一侧改了路径口径,两条测试同时红。
 *
 * 注意与 `fixtures/filter-conditions.json` 的 `tagPath` 向量分工:那边是**正文严格语法**
 * (Rust `parse_tag_path`,前端不再镜像),这边是**界面口径**(放宽段内 md 符号)。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isValidTagPath } from './filter-conditions';

interface PathCase {
  why: string;
  path: string;
  valid: boolean;
}

const cases: PathCase[] = JSON.parse(
  readFileSync(new URL('../../fixtures/tag-path-valid.json', import.meta.url), 'utf8')
);

describe('fixtures/tag-path-valid.json:结构与两侧一致', () => {
  it('条数与覆盖(md 名合法 / 结构非法都要有)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.some((c) => c.valid && c.path.includes('[郴]'))).toBe(true);
    expect(cases.some((c) => !c.valid)).toBe(true);
  });

  it('逐条:isValidTagPath 与声明一致', () => {
    for (const c of cases) expect(isValidTagPath(c.path), `${c.path}:${c.why}`).toBe(c.valid);
  });
});
