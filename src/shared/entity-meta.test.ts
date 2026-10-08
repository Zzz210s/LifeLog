/**
 * 共享向量 `fixtures/entity-meta.json` 的前端侧断言(与 src-tauri/src/db/sql_functions.rs 的
 * SQL 标量函数 `entity_name` / `entity_key` 同读一份)。
 *
 * 口径:entity_name = 第一条非空行裁首尾空白(displayTitle),entity_key = 首行再走
 * normalizeTitle(剥行内 `#` 词元 + 折叠空白 + ASCII 小写)。两者必须与后端 SQL 侧逐值一致 ——
 * 这里跑的是真正的镜像实现,向量里的边界一漂移两侧同时变红。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayTitle, titleOf } from './note-link-syntax';

interface MetaCase {
  name: string;
  meta: string;
  expectName: string;
  expectKey: string;
}
interface Fixture {
  cases: MetaCase[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/entity-meta.json', import.meta.url), 'utf8')
) as Fixture;

describe('fixtures/entity-meta.json 结构合法', () => {
  it('条数达标且字段齐全', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
    for (const c of fixture.cases) {
      expect(c.name).not.toBe('');
      expect(typeof c.meta).toBe('string');
    }
  });
});

describe('entity_name / entity_key 与共享向量一致', () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(displayTitle(c.meta)).toBe(c.expectName);
      expect(titleOf(c.meta)).toBe(c.expectKey);
    });
  }
});
