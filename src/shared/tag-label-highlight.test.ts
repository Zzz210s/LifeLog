/**
 * 高亮下标重定位的共享用例(T1 收尾):`input-bar/TagCompleteList.tsx` 与
 * `palette/providers/tags.ts`(统一输入框 `#` 档)共用 `shared/tag-label-highlight.ts`,
 * 这里是**对共享函数的直接断言**;两个显示位的接线另由各自的 DOM/单测覆盖
 * (`input-bar/tag-complete-md.dom.test.ts`、`palette/providers/tags.test.ts`)。
 */
import { describe, expect, it } from 'vitest';
import { tagLabelPlain } from './tag-label';
import { remapPositions, remapRanges } from './tag-label-highlight';

const RAW = '地点/[郴](chēn)州市';
const PLAIN = '地点/郴州市';

describe('remapRanges:原始路径高亮段 -> 纯文本高亮段', () => {
  it('原始路径是 md 形态:落在保留字符上的段映射到纯文本同段(郴)', () => {
    expect(tagLabelPlain(RAW)).toBe(PLAIN);
    expect(remapRanges(RAW, PLAIN, [{ start: 4, end: 5 }])).toEqual([{ start: 3, end: 4 }]);
  });

  it('段跨过被去掉的语法符号(定位不到)整条退化为无高亮', () => {
    expect(remapRanges(RAW, PLAIN, [{ start: 0, end: 4 }])).toEqual([]);
  });

  it('无 md 语法(plain === raw)原样透传,且返回新数组', () => {
    const ranges = [{ start: 3, end: 4 }];
    const out = remapRanges('工作/项目A', '工作/项目A', ranges);
    expect(out).toEqual(ranges);
    expect(out).not.toBe(ranges);
  });

  it('多段按顺序回落(第二段只在其后找),空段表返回空', () => {
    expect(remapRanges(RAW, PLAIN, [{ start: 0, end: 2 }, { start: 13, end: 15 }])).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 6 },
    ]);
    expect(remapRanges(RAW, PLAIN, [])).toEqual([]);
  });
});

describe('remapPositions:单点下标 -> 纯文本下标', () => {
  it('单个命中点映射到纯文本里的同一字符(郴)', () => {
    expect(remapPositions(RAW, PLAIN, [4])).toEqual([3]);
  });

  it('多点逐个映射,顺序保持', () => {
    expect(remapPositions(RAW, PLAIN, [0, 4, 13])).toEqual([0, 3, 5]);
  });

  it('任一点落在被去掉的语法符号上(定位不到)整条退化为空 = 该行不高亮', () => {
    // raw[3] 是 `[`,不在纯文本里
    expect(remapPositions(RAW, PLAIN, [0, 3])).toEqual([]);
  });

  it('无 md 语法原样透传,且返回新数组', () => {
    const positions = [1, 2];
    const out = remapPositions('工作/项目A', '工作/项目A', positions);
    expect(out).toEqual(positions);
    expect(out).not.toBe(positions);
  });
});
