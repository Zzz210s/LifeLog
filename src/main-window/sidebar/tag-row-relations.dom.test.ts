// @vitest-environment jsdom
/**
 * 树行关系小字(2026-10-06 用户口径:行内**只显示值**):
 * 行内紧跟标签名 `中国大陆` / `日本` 这样的值(无箭头、无属性名),最多 2 个 + `+N`,受开关控制;
 * 悬停这个值出**属性名**气泡(chip 自带 data-tip,覆盖行级档案卡片);计数导轨仍在行尾。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hover, markTruncated, mountTagRow, rel, type RowHarness } from './__fixtures__/tag-row-harness';

let h: RowHarness;

beforeEach(() => {
  h = mountTagRow();
});

afterEach(() => {
  h.unmount();
});

const texts = (): string[] => h.chips().map((el) => el.textContent ?? '');
const tokens = (el: Element): string[] => el.className.split(/\s+/).filter(Boolean);

const CN = rel(10, '中国大陆', '国籍');
const JP = rel(11, '日本', '国籍');

describe('树行关系小字:行内只显示值', () => {
  it('开关关闭:树行不出现关系', () => {
    h.render({ relations: [CN, JP], showRelations: false });
    expect(texts()).toEqual([]);
    expect(h.host.textContent).not.toContain('中国大陆');
  });

  it('开关打开:只显示目标值,既无箭头也无属性名', () => {
    h.render({ relations: [CN, JP], showRelations: true });
    expect(texts()).toEqual(['中国大陆', '日本']);
    expect(h.host.textContent).not.toContain('→');
    expect(h.host.textContent).not.toContain('国籍');
  });

  it('目标名带行内 md / 代理对:显示剥成纯文本的目标名', () => {
    h.render({ relations: [rel(10, '[日本](日出之国)', '国籍'), rel(11, '[𠀀国](日出之国)')], showRelations: true });
    expect(texts()).toEqual(['日本', '𠀀国']);
  });

  it('超过 2 个:显示 2 个值 + `+N`', () => {
    h.render({
      relations: [rel(10, '中国大陆', '国籍'), rel(11, '日本', '国籍'), rel(12, '美国', '出生地'), rel(13, '法国', '出生地')],
      showRelations: true,
    });
    expect(texts()).toEqual(['中国大陆', '日本', '+2']);
  });

  // 判别力:同值多属性不去重会出 [`中国大陆`, `中国大陆`, `+2`]
  it('同值多属性:行内按值去重只显示一次,`+N` 也按去重后的条数算', () => {
    h.render({
      relations: [rel(10, '中国大陆', '国籍'), rel(10, '中国大陆', '出生地'), rel(11, '日本', '国籍'), rel(12, '美国', '出生地')],
      showRelations: true,
    });
    expect(texts()).toEqual(['中国大陆', '日本', '+1']);
  });

  it('行内顺序为 名字 → 关系小字 → 计数(优先级 2026-10-06 调整)', () => {
    const row = h.render({ relations: [CN], showRelations: true });
    const html = row.innerHTML;
    expect(html.indexOf('冯骥才')).toBeLessThan(html.indexOf('data-tag-relation'));
    expect(html.indexOf('data-tag-relation')).toBeLessThan(html.indexOf('data-count-rail'));
    expect(html.slice(html.indexOf('冯骥才'), html.indexOf('data-count-rail'))).toContain('data-tag-relation');
  });
});

describe('悬停那个值:给属性名', () => {
  it('值的 data-tip 就是属性名(信息位常给,不依赖截断);边上没属性名则不挂,回退行级卡片', () => {
    h.render({ relations: [CN, rel(11, '所在')], showRelations: true });
    expect(h.chips()[0].getAttribute('data-tip')).toBe('国籍');
    expect(h.chips()[1].getAttribute('data-tip')).toBeNull();
  });

  it('悬停值立刻出属性名气泡(不是行级档案卡片)', () => {
    h.render({ relations: [CN], showRelations: true });
    hover(h.chips()[0]);
    expect(h.bubble()?.textContent).toBe('国籍');
  });

  it('属性名带行内 md:气泡给纯文本属性名', () => {
    h.render({ relations: [rel(10, '中国大陆', '**国籍**')], showRelations: true });
    hover(h.chips()[0]);
    expect(h.bubble()?.textContent).toBe('国籍');
  });
});

describe('名字优先不截断(2026-10-06 B 方案)', () => {
  it('名字块 shrink-0(不参与收缩),关系小字可收缩 + 封顶 + truncate(截断先落在小字)', () => {
    const row = h.render({ relations: [CN], showRelations: true });
    const name = tokens(h.name(row));
    expect(name).toContain('shrink-0');
    expect(name).not.toContain('shrink');
    expect(name).toContain('truncate');

    const chip = h.chips()[0];
    const ct = tokens(chip);
    expect(ct).toContain('shrink');
    expect(ct).not.toContain('shrink-0');
    expect(ct).toContain('min-w-0');
    expect(String(chip.className)).toMatch(/max-w-\[8rem\]/);
    expect(ct).toContain('truncate');
  });

  it('关系小字被截断时原生 title 仍给完整值(未截断不挂 title)', () => {
    h.render({ relations: [rel(10, '一段很长很长的目标标签名字', '国籍')], showRelations: true });
    const chip = h.chips()[0];
    expect(chip.textContent).toBe('一段很长很长的目标标签名字');
    expect(chip.getAttribute('title')).toBeNull();
    markTruncated(chip);
    hover(chip);
    expect(chip.getAttribute('title')).toBe('一段很长很长的目标标签名字');
  });

  it('行上不再挂原生 title(卡片走 data-tip)', () => {
    const row = h.render({ relations: [CN] });
    expect(row.getAttribute('title')).toBeNull();
  });
});
