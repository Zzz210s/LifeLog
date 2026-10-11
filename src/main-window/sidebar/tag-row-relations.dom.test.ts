// @vitest-environment jsdom
/**
 * 树行关系小字(2026-10-12 T4.3 / spec §9.2 第 1 行):
 * 行内紧跟标签名显示「**名字 + 被引用点**」(`国籍 中国大陆`,中间一个空格、无箭头);
 * 无名字线仍逐字只显示值(`中国大陆`,与 v30 相同);最多 2 个 + `+N`,受开关控制;
 * 悬停这个 chip 出**名字**气泡(chip 自带 data-tip,覆盖行级档案卡片);计数导轨仍在行尾。
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

describe('树行关系小字:名字 + 被引用点', () => {
  it('开关关闭:树行不出现关系', () => {
    h.render({ relations: [CN, JP], showRelations: false });
    expect(texts()).toEqual([]);
    expect(h.host.textContent).not.toContain('中国大陆');
  });

  it('relation_chip_shows_name_and_target:有名线 chip = 名字 + 空格 + 被引用点,不画箭头', () => {
    h.render({ relations: [CN, JP], showRelations: true });
    expect(texts()).toEqual(['国籍 中国大陆', '国籍 日本']);
    expect(h.host.textContent).not.toContain('→');
    expect(CN.nameText).toBe('国籍');
  });

  it('relation_chip_without_name_is_value_only:无名字线 chip 逐字只给值(与 v30 相同)', () => {
    h.render({ relations: [rel(10, '中国大陆')], showRelations: true });
    expect(texts()).toEqual(['中国大陆']);
  });

  it('目标名带行内 md / 代理对:chip 里的目标名剥成纯文本', () => {
    h.render({ relations: [rel(10, '[日本](日出之国)', '国籍'), rel(11, '[𠀀国](日出之国)')], showRelations: true });
    expect(texts()).toEqual(['国籍 日本', '𠀀国']);
  });

  it('超过 2 个:显示 2 个 chip + `+N`', () => {
    h.render({
      relations: [rel(10, '中国大陆', '国籍'), rel(11, '日本', '国籍'), rel(12, '美国', '出生地'), rel(13, '法国', '出生地')],
      showRelations: true,
    });
    expect(texts()).toEqual(['国籍 中国大陆', '国籍 日本', '+2']);
  });

  // 判别力:同值不同名(国籍/出生地)在 v31 名下是两条不同的线,都要各占一个位
  it('同值不同名各占一位:行内按「名字 + 值」去重,`+N` 按去重后的条数算', () => {
    h.render({
      relations: [rel(10, '中国大陆', '国籍'), rel(10, '中国大陆', '出生地'), rel(11, '日本', '国籍'), rel(12, '美国', '出生地')],
      showRelations: true,
    });
    expect(texts()).toEqual(['国籍 中国大陆', '出生地 中国大陆', '+2']);
  });

  it('同名同值去重:同名字 + 同值的重复线只显示一次', () => {
    h.render({
      relations: [rel(10, '中国大陆', '国籍'), rel(10, '中国大陆', '国籍'), rel(11, '日本', '国籍')],
      showRelations: true,
    });
    expect(texts()).toEqual(['国籍 中国大陆', '国籍 日本']);
  });

  it('行内顺序为 名字 → 关系小字 → 计数(优先级 2026-10-06 调整)', () => {
    const row = h.render({ relations: [CN], showRelations: true });
    const html = row.innerHTML;
    expect(html.indexOf('冯骥才')).toBeLessThan(html.indexOf('data-tag-relation'));
    expect(html.indexOf('data-tag-relation')).toBeLessThan(html.indexOf('data-count-rail'));
    expect(html.slice(html.indexOf('冯骥才'), html.indexOf('data-count-rail'))).toContain('data-tag-relation');
  });
});

describe('非关系行内小字与行级档案卡片机制不变(T4.3 口径 ③)', () => {
  it('row_inline_extras_and_tip_rows_unchanged:chip 文案变了,data-tip-rows 仍是每条关系一行(左名字右值)', () => {
    const row = h.render({ relations: [CN, rel(11, '所在')], showRelations: true });
    expect(JSON.parse(row.getAttribute('data-tip-rows') ?? '[]')).toEqual([
      { label: '国籍', value: '中国大陆' },
      { label: '所在', value: '' },
    ]);
    expect(h.chips()[1].getAttribute('data-tip')).toBeNull();
    expect(row.querySelector('[data-count-rail]')?.textContent).toBe('1');
  });
});

describe('悬停那个 chip:给名字', () => {
  it('chip 的 data-tip 就是名字(信息位常给,不依赖截断);无名字线则不挂,回退行级卡片', () => {
    h.render({ relations: [CN, rel(11, '所在')], showRelations: true });
    expect(h.chips()[0].getAttribute('data-tip')).toBe('国籍');
    expect(h.chips()[1].getAttribute('data-tip')).toBeNull();
  });

  it('悬停 chip 立刻出名字气泡(不是行级档案卡片)', () => {
    h.render({ relations: [CN], showRelations: true });
    hover(h.chips()[0]);
    expect(h.bubble()?.textContent).toBe('国籍');
  });

  it('名字带行内 md:气泡给纯文本名字', () => {
    h.render({ relations: [rel(10, '中国大陆', '**国籍**')], showRelations: true });
    hover(h.chips()[0]);
    expect(h.bubble()?.textContent).toBe('国籍');
  });
});

describe('行内 chip 底衬(chip 样式,走令牌)', () => {
  it('chip 上有浅色圆角底衬:bg-tag + rounded-xs + 左右内边(与标签名区分)', () => {
    const row = h.render({ relations: [CN], showRelations: true });
    const chip = row.querySelector('[data-tag-relation]') as HTMLElement;
    const ct = tokens(chip);
    expect(ct).toContain('bg-tag');
    expect(ct).toContain('rounded-xs');
    expect(ct).toContain('px-1');
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

  it('关系小字被截断时原生 title 给完整 chip 文本(未截断不挂 title)', () => {
    h.render({ relations: [rel(10, '一段很长很长的目标标签名字', '国籍')], showRelations: true });
    const chip = h.chips()[0];
    expect(chip.textContent).toBe('国籍 一段很长很长的目标标签名字');
    expect(chip.getAttribute('title')).toBeNull();
    markTruncated(chip);
    hover(chip);
    expect(chip.getAttribute('title')).toBe('国籍 一段很长很长的目标标签名字');
  });

  it('行上不再挂原生 title(卡片走 data-tip)', () => {
    const row = h.render({ relations: [CN] });
    expect(row.getAttribute('title')).toBeNull();
  });
});
