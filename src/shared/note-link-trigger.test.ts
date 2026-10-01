/**
 * `detectLinkTrigger` / `acceptLink` 的行为测试(设计 N2/N5/N7)。
 * 主向量来自仓库根 `fixtures/note-link-trigger.json`(计划给定,caret 可越界);
 * 文件内再补围栏/转义/嵌套/边界的口径断言。围栏与转义口径必须与 `src-tauri/src/links.rs` 一致。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { acceptLink, detectLinkTrigger, type LinkTrigger } from './note-link-trigger';

interface DetectCase {
  name: string;
  text: string;
  caret: number;
  expect: LinkTrigger | null;
}
interface AcceptCase {
  name: string;
  text: string;
  caret: number;
  title: string;
  expect: { text: string; caret: number };
}
interface Fixture {
  note: string;
  detect: DetectCase[];
  accept: AcceptCase[];
}

const fx = JSON.parse(
  readFileSync(new URL('../../fixtures/note-link-trigger.json', import.meta.url), 'utf8')
) as Fixture;

describe('detectLinkTrigger(共享向量)', () => {
  it.each(fx.detect)('$name', ({ text, caret, expect: want }) => {
    expect(detectLinkTrigger(text, caret)).toEqual(want);
  });
});

describe('acceptLink(共享向量)', () => {
  it.each(fx.accept)('$name', ({ text, caret, title, expect: want }) => {
    expect(acceptLink(text, caret, title)).toEqual(want);
  });
});

describe('围栏 / 转义 / 边界的口径(与 links.rs 对齐)', () => {
  it('围栏闭合后恢复触发', () => {
    expect(detectLinkTrigger('```\n[[甲\n```\n[[乙', 15)).toEqual({ start: 12, query: '乙' });
  });

  it('~~~ 围栏同样不触发,行内代码与围栏互不影响', () => {
    expect(detectLinkTrigger('~~~\n[[甲', 7)).toBeNull();
    expect(detectLinkTrigger('`code` [[甲', 10)).toEqual({ start: 7, query: '甲' });
  });

  it('转义只作用于下一个字符', () => {
    expect(detectLinkTrigger('\\[[甲', 4)).toBeNull();
    expect(detectLinkTrigger('[[甲 \\[[乙', 9)).toEqual({ start: 0, query: '甲 \\[[乙' });
  });

  it('已闭合链接里的 [[ 不再重启(嵌套整串字面)', () => {
    expect(detectLinkTrigger('[[甲[[乙]]', 9)).toBeNull();
    expect(detectLinkTrigger('[[甲]] [[乙', 11)).toEqual({ start: 6, query: '乙' });
  });

  it('caret 越界与负值都按区间夹取', () => {
    expect(detectLinkTrigger('[[甲', 99)).toEqual({ start: 0, query: '甲' });
    expect(detectLinkTrigger('[[甲', -3)).toBeNull();
  });
});
