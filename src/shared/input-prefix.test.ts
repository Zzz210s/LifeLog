import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NOTE_PREFIX, PREFIXES, parseInput, withPrefix } from './input-prefix';

const fx = JSON.parse(readFileSync('fixtures/input-prefix.json', 'utf-8')) as {
  cases: { raw: string; mode: string; query: string }[];
};

describe('parseInput(向量驱动,Rust 侧不涉)', () => {
  for (const c of fx.cases) {
    it(`raw=${JSON.stringify(c.raw)} -> ${c.mode}`, () => {
      const got = parseInput(c.raw);
      expect(got.mode).toBe(c.mode);
      expect(got.query).toBe(c.query);
    });
  }
});

describe('PREFIXES 表', () => {
  it('四个前缀各一条,顺序固定,提示文案非空', () => {
    expect(PREFIXES.map((p) => p.prefix)).toEqual(['>', '/', '#', '@']);
    for (const p of PREFIXES) expect(p.hint.length).toBeGreaterThan(0);
  });
  it('无前缀那条单独导出,且 mode=note', () => {
    expect(NOTE_PREFIX.prefix).toBe('');
    expect(NOTE_PREFIX.mode).toBe('note');
  });
});

describe('withPrefix:切换前缀保留内容', () => {
  it('/牛奶 -> #牛奶', () => expect(withPrefix('/牛奶', '#')).toBe('#牛奶'));
  it('牛奶 -> @牛奶', () => expect(withPrefix('牛奶', '@')).toBe('@牛奶'));
  it('@ -> <> (切到命令)', () => expect(withPrefix('@', '>')).toBe('>'));
  it('空 -> /', () => expect(withPrefix('', '/')).toBe('/'));
});
