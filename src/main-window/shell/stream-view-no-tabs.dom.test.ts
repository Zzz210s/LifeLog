// @vitest-environment jsdom
/**
 * Task 3 的删模块证据:信息流视图里**没有标签页栏**(`[role="tablist"]` 0 个)。
 * 这条钉住"删了组件却忘删渲染"的回归 —— 把标签页栏的渲染加回 StreamView 当场红;
 * 同时断言统一输入框与条件栏还在,免得"整块没渲染"也能骗过前一条。
 * 装配与其他 StreamView 用例共用 `__fixtures__/stream-view-harness.ts`。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTE, installGeometryStubs, mountStreamView } from './__fixtures__/stream-view-harness';

const { getSetting, setSetting, saveInputNote } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string) => {}),
  saveInputNote: vi.fn(async (_s: string) => 1),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting, saveInputNote } }));

beforeEach(() => {
  installGeometryStubs();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('信息流视图:没有标签页栏(删模块的回归钉)', () => {
  it('渲染里没有 [role="tablist"],而统一输入框与条件栏都在', async () => {
    const m = await mountStreamView({ notes: [NOTE] });
    expect(m.host.querySelector('[role="tablist"]')).toBeNull();
    expect(m.host.querySelector('[data-testid="unified-input"]')).not.toBeNull();
    expect(m.host.querySelector('[data-testid="condition-bar"]')).not.toBeNull();
    m.unmount();
  });
});
