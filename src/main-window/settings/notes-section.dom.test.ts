// @vitest-environment jsdom
/**
 * 设置页「条目」分区的文案口径(spec 2026-10-08 §4.2 / §5.3 / §4.1):
 * ① 分区名是「条目」(旧名「笔记」已废),与侧栏「实体」同一口径;
 * ② 末尾一段只读说明交代信息流默认筛选的**来源**(数据库迁移预置,等价于过去的笔记列表)
 *   与**处置**(可编辑、可清空;清空后显示全部实体)—— 说明只读,不新增内置判据。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSetting = vi.fn(async (_key: string) => '');
vi.mock('../../shared/api', () => ({
  api: {
    getSetting: (k: string) => getSetting(k),
    setSetting: vi.fn(async () => undefined),
    validateTimeTagTemplate: vi.fn(async () => undefined),
  },
}));

import { NotesSection } from './NotesSection';
import { SETTINGS_SECTIONS } from './settings-sections';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  getSetting.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** 等一次挂载后的设置读取(useEffect -> Promise.all)落地 */
const flush = (): Promise<void> =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

describe('设置页「条目」分区', () => {
  it('导航与分区标题都是「条目」,旧分区名「笔记」已不出现', async () => {
    await act(async () => root.render(createElement(NotesSection)));
    await flush();

    expect(SETTINGS_SECTIONS.map((s) => s.label)).not.toContain('笔记');
    expect(SETTINGS_SECTIONS.find((s) => s.id === 'notes')?.label).toBe('条目');
    expect(host.querySelector('h2')?.textContent).toBe('条目');
  });

  it('末尾只读说明:默认筛选来自迁移预置、可编辑、可清空', async () => {
    await act(async () => root.render(createElement(NotesSection)));
    await flush();

    const note = host.querySelector('[data-testid="default-filter-note"]');
    expect(note, '缺少默认筛选来源说明').not.toBeNull();
    const text = note?.textContent ?? '';
    expect(text).toContain('迁移预置');
    expect(text).toContain('可编辑');
    expect(text).toContain('可清空');
    expect(text).toContain('全部实体');
    // 只读说明:不是控件(没有 input/button/select)
    expect(note?.querySelector('input, button, select')).toBeNull();
  });
});
