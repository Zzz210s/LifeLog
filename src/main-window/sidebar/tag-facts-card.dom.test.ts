// @vitest-environment jsdom
/**
 * 悬浮档案卡片(2026-10-06 用户口径:悬停标签名像档案一样一行一行):
 * 第一行路径、第二行计数,之后**每条关系一行**,左列属性名(muted)、右列值;
 * 同值多属性在卡片里**不去重**(各带自己的属性名,如 国籍/出生地 都指向 中国大陆);
 * 边上没有属性名时左列回退显示目标名(R12,不留空行)。
 * 实现:行上 `data-tip` 给标题两行、`data-tip-rows` 给关系行(HoverTip → TipBubble 两列网格)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hover, mountTagRow, rel, type RowHarness } from './__fixtures__/tag-row-harness';

let h: RowHarness;

beforeEach(() => {
  h = mountTagRow();
});

afterEach(() => {
  h.unmount();
});

const labels = (): string[] =>
  [...(h.bubble()?.querySelectorAll('[data-tip-row-label]') ?? [])].map((el) => el.textContent ?? '');
const values = (): string[] =>
  [...(h.bubble()?.querySelectorAll('[data-tip-row-value]') ?? [])].map((el) => el.textContent ?? '');

const SAME_TARGET = [rel(10, '中国大陆', '国籍'), rel(10, '中国大陆', '出生地'), rel(11, '日本', '国籍')];

describe('档案卡片:标题两行', () => {
  it('第一行路径、第二行计数(仍是既有口径)', () => {
    const row = h.render({ relations: SAME_TARGET });
    expect((row.getAttribute('data-tip') ?? '').split('\n')).toEqual(['作者/冯骥才', '本级 1 / 含子级 1']);
  });

  it('无关系:仍只有路径与计数两行,不出关系行', () => {
    const row = h.render();
    expect((row.getAttribute('data-tip') ?? '').split('\n')).toEqual(['作者/冯骥才', '本级 1 / 含子级 1']);
    expect(row.getAttribute('data-tip-rows')).toBeNull();
  });
});

describe('档案卡片:一条关系一行,两列', () => {
  it('悬停标签名出卡片,行数 = 关系数,左列属性名 + 右列值', () => {
    const row = h.render({ relations: SAME_TARGET });
    hover(h.name(row));
    expect(h.bubble()?.textContent).toContain('作者/冯骥才');
    expect(h.bubble()?.textContent).toContain('本级 1 / 含子级 1');
    expect(labels()).toEqual(['国籍', '出生地', '国籍']);
    expect(values()).toEqual(['中国大陆', '中国大陆', '日本']);
  });

  // 判别力:卡片若按行内口径去重,labels 会少一条(出生地 消失)
  it('同值多属性:行内去重、卡片不去重(两条各带自己的属性名)', () => {
    const row = h.render({ relations: SAME_TARGET, showRelations: true });
    expect(h.chips().map((el) => el.textContent)).toEqual(['中国大陆', '日本']);
    hover(h.name(row));
    expect(labels()).toEqual(['国籍', '出生地', '国籍']);
    expect(values()).toEqual(['中国大陆', '中国大陆', '日本']);
  });

  it('左列属性名走 muted(右列值走默认文字色)', () => {
    const row = h.render({ relations: [rel(10, '中国大陆', '国籍')] });
    hover(h.name(row));
    const label = h.bubble()?.querySelector('[data-tip-row-label]') as HTMLElement;
    expect(label.className.split(/\s+/)).toContain('text-muted');
  });

  it('属性名与目标名的行内 md 都在卡片里剥成纯文本', () => {
    const row = h.render({ relations: [rel(10, '[日本](日出之国)', '**国籍**')] });
    hover(h.name(row));
    expect(labels()).toEqual(['国籍']);
    expect(values()).toEqual(['日本']);
  });
});

describe('档案卡片:无属性名的回退(R12)', () => {
  it('左列显示目标名,右列空,不许出现空行', () => {
    const row = h.render({ relations: [rel(12, '所在', ''), rel(10, '中国大陆', '国籍')] });
    hover(h.name(row));
    expect(labels()).toEqual(['所在', '国籍']);
    expect(values()).toEqual(['', '中国大陆']);
    expect(h.bubble()?.textContent).toContain('所在');
  });
});
