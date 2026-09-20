/**
 * 共享测试向量(仓库根 `fixtures/*.json`)的前端侧断言。
 *
 * - `tag-grammar.json`:前端**不实现**标签语法(再写一份等于把漂移固化),解析一律走
 *   后端命令 `parse_note_source`。这里只做契约断言:fixture 结构合法 + 前端确实接线该命令。
 *   **若将来前端要镜像语法,必须让本文件的断言真正跑一遍镜像实现**,而不是只断言结构。
 * - `filter-conditions.json`:每条喂给前端**真实的**校验/归一函数(isValidTagPath /
 *   parseFilterJson / applyTagPick / localExprError);Rust 侧读同一份文件断言后端真源
 *   (见 src-tauri/src/filter_fixtures_tests.rs),同一份向量两边各跑一遍才能发现漂移。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  MAX_EXPR_CHARS,
  isFilterEmpty,
  isValidTagPath,
  type FilterConditions,
} from './filter-conditions';
import { parseFilterJson } from './filter-conditions-parse';
import { applyTagPick } from '../main-window/filter/filter-chips';
import { localExprError } from '../main-window/filter/expr-check';

const readFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../fixtures/${name}`, import.meta.url), 'utf8'));

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

interface TagCase {
  why?: string;
  source: string;
  content: string;
  tags: string[];
}
interface TagPathCase {
  why: string;
  path: string;
  valid: boolean;
}
interface PickStep {
  path: string;
  exclude: boolean;
  includeChildren: boolean;
  times: number;
}
interface ConditionCase {
  why: string;
  raw: unknown;
  valid?: boolean;
  normalized?: FilterConditions;
  empty?: boolean;
  applyPick?: PickStep;
  afterPick?: FilterConditions;
}
interface ExprCase {
  why: string;
  src: string;
  valid: boolean;
}

const tagCases = readFixture('tag-grammar.json') as TagCase[];
const filterCases = readFixture('filter-conditions.json') as Array<{ kind: string }>;
const ofKind = <T>(kind: string): T[] =>
  filterCases.filter((e) => e.kind === kind) as unknown as T[];

describe('fixtures/tag-grammar.json(前端契约:语法由后端实现)', () => {
  it('结构合法:字段齐全、tags 非空且无重复、条数达标', () => {
    expect(tagCases.length).toBeGreaterThanOrEqual(25);
    for (const c of tagCases) {
      expect(typeof c.source, c.why).toBe('string');
      expect(typeof c.content, c.why).toBe('string');
      expect(Array.isArray(c.tags), c.why).toBe(true);
      expect(new Set(c.tags).size, c.why).toBe(c.tags.length);
      for (const t of c.tags) {
        expect(t.length, c.why).toBeGreaterThan(0);
        expect(t, c.why).toBe(t.trim());
      }
    }
  });

  it('接线契约:前端解析走 parse_note_source 命令,不自己复制语法', () => {
    expect(readSource('./api.ts')).toMatch(/parse_note_source/);
    expect(readSource('./api.ts')).toMatch(/ParseResult/);
    expect(readSource('./types.ts')).toMatch(/interface ParseResult/);
    // 编辑面板经 use-source-tags 调该命令(面板自己不拼命令名、更不实现语法),
    // 该接线随实时标签数一并落地,见后续提交的 EditPanel/use-source-tags。
  });
});

describe('fixtures/filter-conditions.json(前端真实校验函数)', () => {
  it('结构合法:三类 kind 齐全、条数达标、condition 缺字段情形声明完整', () => {
    expect(filterCases.length).toBeGreaterThanOrEqual(20);
    for (const e of filterCases) {
      expect(['tagPath', 'condition', 'expr'], JSON.stringify(e)).toContain(e.kind);
    }
    for (const c of ofKind<ConditionCase>('condition')) {
      if (c.valid !== false) {
        expect(c.normalized, c.why).toBeDefined();
        expect(c.empty, c.why).toBeDefined();
      }
    }
  });

  it('tagPath:isValidTagPath 与声明一致', () => {
    for (const c of ofKind<TagPathCase>('tagPath')) {
      expect(isValidTagPath(c.path), `${c.path}:${c.why}`).toBe(c.valid);
    }
  });

  it('condition:parseFilterJson 归一/回退与声明一致', () => {
    for (const c of ofKind<ConditionCase>('condition')) {
      const got = parseFilterJson(JSON.stringify(c.raw));
      if (c.valid === false) {
        // 整体非法(超上限/取值非法)→ 回退 EMPTY_FILTER,绝不把半成品放进状态机
        expect(got, c.why).toEqual(EMPTY_FILTER);
        continue;
      }
      expect(got, c.why).toEqual(c.normalized);
      expect(isFilterEmpty(got), c.why).toBe(c.empty);
    }
  });

  it('condition:applyTagPick 重复落笔只留一条', () => {
    const picked = ofKind<ConditionCase>('condition').filter((c) => c.applyPick);
    expect(picked.length).toBeGreaterThan(0);
    for (const c of picked) {
      const step = c.applyPick as PickStep;
      let got = parseFilterJson(JSON.stringify(c.raw));
      for (let i = 0; i < step.times; i++) {
        got = applyTagPick(got, step.path, {
          exclude: step.exclude,
          includeChildren: step.includeChildren,
        });
      }
      expect(got, c.why).toEqual(c.afterPick);
    }
  });

  it('expr:前端只判长度,语义一律交后端(同一份文件的 Rust 侧断言真源)', () => {
    const exprs = ofKind<ExprCase>('expr');
    expect(exprs.length).toBeGreaterThanOrEqual(10);
    for (const e of exprs) {
      // 长度内的表达式前端一律不拦截:valid 的语义由 Rust expr::validate 裁决
      expect(localExprError(e.src), `${e.src}:${e.why}`).toBeNull();
      expect([...e.src].length, e.why).toBeLessThanOrEqual(MAX_EXPR_CHARS);
    }
  });

  it('expr:长度层确实会拒绝超长表达式(与 Rust MAX_LEN 同口径)', () => {
    expect(MAX_EXPR_CHARS).toBe(500);
    expect(localExprError('a'.repeat(MAX_EXPR_CHARS))).toBeNull();
    expect(localExprError('a'.repeat(MAX_EXPR_CHARS + 1))).not.toBeNull();
  });
});
