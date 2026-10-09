/**
 * 共享测试向量 `fixtures/entity-link-targets.json` 的前端侧断言(spec §5.1 / P5)。
 * 与 Rust 侧 `note_link_fixtures_tests.rs` 读同一份文件、跑同一套用例:
 * 前端跑 `resolveLinkTarget`,后端跑 `note_links::resolve_target`,漂移时两边同时变红。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { resolveLinkTarget, type LinkCandidate } from './note-link';

interface Entity {
  id: number;
  meta: string;
  path?: string | null;
}
interface TargetCase {
  why: string;
  rawTitle: string;
  exclude?: number | null;
  expect: number | null;
}
interface Fixture {
  entities: Entity[];
  cases: TargetCase[];
}

const fixture: Fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/entity-link-targets.json', import.meta.url), 'utf8')
);

/** 与产品同口径的候选表:唯一键 = meta 首行归一化,path 不进候选(它只是显示缓存) */
const toCandidates = (entities: readonly Entity[]): LinkCandidate[] =>
  entities.map((e) => ({ id: e.id, meta: e.meta }));

describe('entity-link-targets 共享向量(统一元数据后)', () => {
  it('结构契约:实体 id 唯一、why 非空、expect 都指向已声明实体', () => {
    const ids = new Set(fixture.entities.map((e) => e.id));
    expect(ids.size).toBe(fixture.entities.length);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(12);
    for (const c of fixture.cases) {
      expect(c.why, 'why 不能为空').not.toBe('');
      if (c.expect !== null) {
        expect(ids.has(c.expect), `${c.why}: expect=${c.expect} 不在实体表`).toBe(true);
      }
    }
  });

  it('resolveLinkTarget 与向量逐条一致', () => {
    const candidates = toCandidates(fixture.entities);
    for (const c of fixture.cases) {
      expect(resolveLinkTarget(candidates, c.rawTitle, c.exclude ?? null), c.why).toBe(c.expect);
    }
  });

  it('同键取 id 最小(不再有种类优先;变异自证靶点)', () => {
    const candidates: LinkCandidate[] = [
      { id: 4, meta: '撞名' },
      { id: 1000000003, meta: '撞名' },
    ];
    expect(resolveLinkTarget(candidates, '撞名')).toBe(4);
  });

  it('resolve_link_target_has_no_kind_branch:候选带旧 kind 标注也不改裁决', () => {
    // 旧实现按种类优先级(标签优先于笔记);统一后只剩「同键取 id 最小」。
    // 这里把旧 kind 经 unknown 注入:标签 id(9)更大 —— 若恢复种类优先会返回 9。
    const candidates = [
      { id: 3, meta: '撞名', kind: 'note' },
      { id: 9, meta: '撞名', kind: 'tag' },
    ] as unknown as LinkCandidate[];
    expect(resolveLinkTarget(candidates, '撞名')).toBe(3);
  });

  it('类型层:LinkCandidate 无实体种类字段', () => {
    expectTypeOf<LinkCandidate>().not.toHaveProperty('kind');
    expectTypeOf<LinkCandidate['meta']>().toEqualTypeOf<string>();
  });

  it('按 entity_key(meta) 匹配而不是 path(变异自证靶点)', () => {
    const candidates = toCandidates([{ id: 112, meta: '甲/乙', path: '显示缓存/甲/乙' }]);
    expect(resolveLinkTarget(candidates, '甲/乙')).toBe(112);
    expect(resolveLinkTarget(candidates, '显示缓存/甲/乙')).toBeNull();
  });
});
