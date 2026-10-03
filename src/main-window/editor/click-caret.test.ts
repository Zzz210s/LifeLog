// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { blockRange, sourceOffsetForClick, visibleToSourceOffset } from './click-caret';

const SRC = ['第一段正文', '', '## 标题二', '', '- 甲', '- 乙', '', '结尾段', '', '#日期/2026/10/03'].join('\n');

describe('blockRange(顶层块的源码区间)', () => {
  it('第 0 块 = 第一段', () => {
    const r = blockRange(SRC, 0);
    expect(SRC.slice(r!.start, r!.end)).toBe('第一段正文');
  });
  it('第 1 块 = 标题行(渲染成 h2)', () => {
    const r = blockRange(SRC, 1);
    expect(SRC.slice(r!.start, r!.end)).toBe('## 标题二');
  });
  it('第 2 块 = 列表(两行一起)', () => {
    const r = blockRange(SRC, 2);
    expect(SRC.slice(r!.start, r!.end)).toBe('- 甲\n- 乙');
  });
  it('第 3 块 = 结尾段', () => {
    const r = blockRange(SRC, 3);
    expect(SRC.slice(r!.start, r!.end)).toBe('结尾段');
  });
  it('越界返回 null', () => {
    expect(blockRange(SRC, 99)).toBeNull();
  });
});

describe('visibleToSourceOffset(块内换算)', () => {
  it('纯文本:一一对应', () => {
    expect(visibleToSourceOffset('第一段正文', 3)).toBe(3);
  });
  it('标题行首的 `## ` 不计入可见字符', () => {
    expect(visibleToSourceOffset('## 标题二', 1)).toBe(4); // 第 1 个可见字「标」之后
    expect(visibleToSourceOffset('## 标题二', 3)).toBe(6);
  });
  it('列表标记 `- ` 不计入可见字符', () => {
    expect(visibleToSourceOffset('- 甲', 1)).toBe(3);
  });
  it('行内标记跳过', () => {
    expect(visibleToSourceOffset('**粗**体', 1)).toBe(5);
    expect(visibleToSourceOffset('**粗**体', 2)).toBe(6);
  });
  it('多行:换行与行首标记都不占位', () => {
    expect(visibleToSourceOffset('- 甲\n- 乙', 2)).toBe(7); // 第 2 个可见字「乙」之后
  });
  it('越界收敛到块尾', () => {
    expect(visibleToSourceOffset('甲', 99)).toBe(1);
  });
});

describe('sourceOffsetForClick(绝对偏移)', () => {
  it('点第一段第 3 个字 -> 偏移 3', () => {
    expect(sourceOffsetForClick(SRC, 0, 3)).toBe(3);
  });
  it('点标题第 2 个字 -> 落在源码标题行里(不是末尾)', () => {
    const off = sourceOffsetForClick(SRC, 1, 2)!;
    const lineStart = SRC.indexOf('## 标题二');
    expect(off).toBeGreaterThanOrEqual(lineStart);
    expect(off).toBeLessThanOrEqual(lineStart + '## 标题二'.length);
  });
  it('点结尾段 -> 落在结尾段内,且不越过末行标签', () => {
    const off = sourceOffsetForClick(SRC, 3, 1)!;
    expect(SRC.slice(off - 3, off)).toContain('结');
    expect(off).toBeLessThan(SRC.lastIndexOf('\n'));
  });
  it('块号越界 -> null(调用方退回末尾)', () => {
    expect(sourceOffsetForClick(SRC, 99, 1)).toBeNull();
  });
});
