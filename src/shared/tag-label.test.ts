// @vitest-environment jsdom
/**
 * 标签名行内 md(T1)的前端真源断言:共享向量 `fixtures/tag-label.json` 逐条喂给
 * `tagLabelPlain`(纯文本口径)与 `renderTagLabel`(显示口径),两列必须一致;
 * 并钉住「链接渲染成 span + title,永不渲染成 <a>」这条硬约束(变异自证的靶子)。
 *
 * Rust 侧 T2 读同一份向量(至少 raw/plain 两列),同一份数据两边各跑一遍才能发现漂移。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderTagLabel, tagLabelPlain } from './tag-label';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Case {
  why: string;
  raw: string;
  plain: string;
  html: string;
}

/** jsdom 环境下 import.meta.url 不是 file://,直接从仓库根取向量(vitest 的 root 即仓库根) */
const CASES = JSON.parse(
  readFileSync(resolve(process.cwd(), 'fixtures/tag-label.json'), 'utf8')
) as Case[];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** 渲染一条标签名,返回承载节点(可见文本 = textContent) */
function render(raw: string): HTMLElement {
  act(() => root.render(createElement('div', { 'data-raw': raw }, renderTagLabel(raw))));
  return host.firstElementChild as HTMLElement;
}

describe('fixtures/tag-label.json:结构与两侧一致', () => {
  it('结构合法:三列都是字符串、条数达标', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(15);
    for (const c of CASES) {
      expect(typeof c.raw, c.why).toBe('string');
      expect(typeof c.plain, c.why).toBe('string');
      expect(typeof c.html, c.why).toBe('string');
    }
    // 必须覆盖用户定下的写法与全部退化边界
    const raws = CASES.map((c) => c.raw);
    for (const must of ['[郴](chēn)州市', '[a]', '[](x)', '[]()', '**', '`', '地点/美国']) {
      expect(raws, must).toContain(must);
    }
  });

  it('tagLabelPlain 与 plain 列逐条一致', () => {
    for (const c of CASES) expect(tagLabelPlain(c.raw), `${c.raw}:${c.why}`).toBe(c.plain);
  });

  it('renderTagLabel 的可见文本与 html 列逐条一致', () => {
    for (const c of CASES) expect(render(c.raw).textContent, `${c.raw}:${c.why}`).toBe(c.html);
  });

  it('任何一条都不渲染出 <a>(标签不是链接)', () => {
    for (const c of CASES) expect(render(c.raw).querySelector('a'), c.raw).toBeNull();
  });
});

describe('renderTagLabel:链接 = 纯文本 span + title', () => {
  it('备注夹在中间:整体可见文本是 郴州市,「郴」上挂着 title=chēn', () => {
    const box = render('[郴](chēn)州市');
    expect(box.textContent).toBe('郴州市');
    const span = box.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.tagName).toBe('SPAN');
    expect(span?.textContent).toBe('郴');
    expect(span?.getAttribute('title')).toBe('chēn');
    expect(box.querySelector('a')).toBeNull();
  });

  it('含 / 的完整路径:链接只吃自己那一段,前缀路径留在兄弟文本里', () => {
    const box = render('地点/[郴](chēn)州市');
    expect(box.textContent).toBe('地点/郴州市');
    expect(box.querySelectorAll('span')).toHaveLength(1);
    expect(box.textContent).toContain('地点/');
  });

  it('带备注的字加 .tag-note(下划点线),无备注的字保持本体样式', () => {
    const withNote = render('[郴](chēn)州市');
    expect(withNote.querySelector('span')?.className).toBe('tag-note');
    expect(withNote.textContent).toBe('郴州市');
    const noNote = render('[郴]()州市');
    expect(noNote.textContent).toBe('郴州市');
    expect(noNote.querySelector('span')).toBeNull();
  });

  it('普通路径不产生任何元素(退回纯文本)', () => {
    expect(renderTagLabel('地点/美国')).toBe('地点/美国');
    expect(render('地点/美国').children).toHaveLength(0);
  });

  it('空文本链接退化为字面量,不留空 span', () => {
    const box = render('[](x)');
    expect(box.textContent).toBe('[](x)');
    expect(box.querySelector('span')).toBeNull();
  });
});

describe('renderTagLabel:强调与行内代码', () => {
  it('粗体/斜体/代码各自出元素,内容为去掉符号的文本', () => {
    expect(render('**重点**').querySelector('strong')?.textContent).toBe('重点');
    expect(render('*斜体*').querySelector('em')?.textContent).toBe('斜体');
    const code = render('`代码`').querySelector('code');
    expect(code?.textContent).toBe('代码');
    expect(code?.className).toContain('font-mono');
  });

  it('未闭合的 ** / 反引号原样为文本(不产出元素)', () => {
    expect(render('**').children).toHaveLength(0);
    expect(render('**重点*').textContent).toBe('**重点*');
    expect(render('`').textContent).toBe('`');
  });
});

describe('renderTagLabel:删除线 / 下划线强调 / 反斜杠转义(T1)', () => {
  it('~~ 出 <del>,词内也生效(与正文 GFM 一致)', () => {
    expect(render('~~删除线~~').querySelector('del')?.textContent).toBe('删除线');
    expect(render('x~~y~~z').textContent).toBe('xyz');
    expect(render('~~未闭合').children).toHaveLength(0);
  });

  it('_ / __ 出 <em> / <strong>,但带 flanking 守卫', () => {
    expect(render('_斜体_').querySelector('em')?.textContent).toBe('斜体');
    expect(render('__粗体__').querySelector('strong')?.textContent).toBe('粗体');
    expect(render('地点/_斜体_').textContent).toBe('地点/斜体');
    // 词内 / 单侧定界符一律字面(否则 snake_case 这类真实标签名会被吃掉)
    for (const literal of ['a_b_c', 'snake_case', '工作__重点__', '_斜体_州市', '_前置', '后置_']) {
      expect(render(literal).children, literal).toHaveLength(0);
      expect(render(literal).textContent, literal).toBe(literal);
    }
  });

  it('反斜杠转义:去反斜杠、字面显示,且不产元素', () => {
    expect(render('\\*').textContent).toBe('*');
    expect(render('\\*').children).toHaveLength(0);
    // 转义掉的下划线不再是定界符
    expect(render('\\_斜体\\_').textContent).toBe('_斜体_');
    expect(render('\\_斜体\\_').querySelector('em')).toBeNull();
    expect(render('\\').textContent).toBe('\\');
  });
});
