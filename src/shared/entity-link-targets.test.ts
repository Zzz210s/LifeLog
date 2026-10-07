/**
 * 共享测试向量 `fixtures/entity-link-targets.json` 的前端侧断言(D6 `[[ ]]` 目标裁决)。
 * 与 Rust 侧 `note_link_fixtures_tests.rs` 读同一份文件、跑同一套用例:
 * 前端跑 `resolveLinkTarget`,后端跑 `note_links::resolve_target`,漂移时两边同时变红。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveLinkTarget, type LinkCandidate } from './note-link';

interface Entity {
  id: number;
  kind: 'note' | 'tag';
  name?: string | null;
  content?: string | null;
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

describe('entity-link-targets 共享向量(D6)', () => {
  it('结构契约:实体 id 唯一、why 非空、expect 都指向已声明实体', () => {
    const ids = new Set(fixture.entities.map((e) => e.id));
    expect(ids.size).toBe(fixture.entities.length);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(10);
    for (const c of fixture.cases) {
      expect(c.why, 'why 不能为空').not.toBe('');
      if (c.expect !== null) expect(ids.has(c.expect), `${c.why}: expect=${c.expect} 不在实体表`).toBe(true);
    }
  });

  it('resolveLinkTarget 与向量逐条一致', () => {
    const candidates: LinkCandidate[] = fixture.entities.map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      content: e.content,
    }));
    for (const c of fixture.cases) {
      expect(resolveLinkTarget(candidates, c.rawTitle, c.exclude ?? null), c.why).toBe(c.expect);
    }
  });

  it('双端同名时标签优先(变异自证靶点)', () => {
    const candidates: LinkCandidate[] = [
      { id: 4, kind: 'note', content: '撞名' },
      { id: 1000000003, kind: 'tag', name: '撞名' },
    ];
    expect(resolveLinkTarget(candidates, '撞名')).toBe(1000000003);
  });
});
