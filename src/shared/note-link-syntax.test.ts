/**
 * 共享向量 `fixtures/note-links.json` 的前端侧断言(与 src-tauri/src/links.rs 的
 * links_tests.rs 同读一份)。这里跑的是**真正的镜像实现**,不是只断言结构 ——
 * 链接语法的跳过口径(围栏/行内代码/转义)一旦两侧漂移,同一向量会同时变红。
 * 已知差异(TS 的标签词元剥离是近似)见 note-link-syntax.ts 文件头注释。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeTitle, noteLinkSpans, titleOf } from './note-link-syntax';

interface SpanCase {
  name: string;
  content: string;
  expect: string[];
}
interface TitleCase {
  name: string;
  content: string;
  expect: string;
}
interface Fixture {
  spans: SpanCase[];
  titles: TitleCase[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/note-links.json', import.meta.url), 'utf8')
) as Fixture;

describe('fixtures/note-links.json 结构合法', () => {
  it('条数达标', () => {
    expect(fixture.spans.length).toBeGreaterThanOrEqual(9);
    expect(fixture.titles.length).toBeGreaterThanOrEqual(5);
  });
});

describe('链接扫描与共享向量一致', () => {
  for (const c of fixture.spans) {
    it(c.name, () => {
      expect(noteLinkSpans(c.content).map((s) => s.rawTitle)).toEqual(c.expect);
    });
  }
});

describe('首行标题与共享向量一致', () => {
  for (const c of fixture.titles) {
    it(c.name, () => {
      expect(titleOf(c.content)).toEqual(c.expect);
    });
  }
});

describe('区间与归一化边界', () => {
  it('start/end 正好切出 [[…]] 原文', () => {
    const text = '看 [[今天聚会]] 与 [[乙]]';
    const spans = noteLinkSpans(text);
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['[[今天聚会]]', '[[乙]]']);
  });

  it('标题词元剥离后不参与匹配', () => {
    expect(normalizeTitle('  聚会  #日记  ')).toBe('聚会');
    expect(normalizeTitle('#安利/软件')).toBe('');
  });
});
