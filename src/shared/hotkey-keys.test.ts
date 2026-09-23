/**
 * 主键名表(TS 侧)与 Rust 真源的漂移探测。
 *
 * `fixtures/hotkey-spec.json` 的 `mainKeys` 是两侧唯一真源:这里断言本表集合与它逐条相等,
 * Rust 侧(`hotkey_fixtures_tests.rs`)断言每个名字喂回 `hotkey_spec::check` 后仍是自身。
 * 两侧都过 = TS 放行的键名 Rust 一定认得(反之亦然),录制器不会写出「按了没反应」的死键。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAIN_KEY_NAMES, canonicalMainKey } from './hotkey-keys';
import { normalizeParts } from './hotkey-display';

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/hotkey-spec.json', import.meta.url), 'utf8'),
) as { mainKeys: string[] };

describe('主键名表与 fixtures/hotkey-spec.json 同源', () => {
  it('本表集合与 fixture 的 mainKeys 逐条相等', () => {
    expect(fixture.mainKeys.length).toBeGreaterThanOrEqual(100);
    expect([...MAIN_KEY_NAMES].sort()).toEqual([...fixture.mainKeys].sort());
  });

  it('规范名幂等;插件别名归一到规范名;Rust 不认的键名一律 null', () => {
    for (const name of MAIN_KEY_NAMES) expect(canonicalMainKey(name), name).toBe(name);
    expect(canonicalMainKey('Esc')).toBe('escape');
    expect(canonicalMainKey('up')).toBe('arrowup');
    expect(canonicalMainKey('KEYQ')).toBe('q');
    expect(canonicalMainKey('volumeup')).toBe('audiovolumeup');
    expect(canonicalMainKey('[')).toBe('bracketleft');
    expect(canonicalMainKey(' numadd ')).toBe('numpadadd');
    expect(canonicalMainKey('zzz')).toBeNull();
    expect(canonicalMainKey('intlbackslash')).toBeNull();
    expect(canonicalMainKey('f25')).toBeNull();
    expect(canonicalMainKey('key')).toBeNull();
  });

  it('单键只放行 F1-F24:表里恰好 24 个功能键,其余单键全部拒绝', () => {
    const fkeys = MAIN_KEY_NAMES.filter((n) => /^f\d+$/.test(n)).sort(
      (a, b) => Number(a.slice(1)) - Number(b.slice(1))
    );
    expect(fkeys).toEqual(Array.from({ length: 24 }, (_, i) => `f${i + 1}`));
    for (const name of MAIN_KEY_NAMES) {
      expect(normalizeParts([name]), name).toBe(fkeys.includes(name) ? name : null);
    }
  });
});
