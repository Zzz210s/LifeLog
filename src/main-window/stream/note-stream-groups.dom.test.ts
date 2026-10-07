// @vitest-environment jsdom
/**
 * 信息流接线(计划 T5):grouping 非空渲染分组(组头 + 组内卡片),为空走平铺原分支;
 * notice 渲染顶部提示条。装配与其他 StreamView 用例共用 __fixtures__/stream-view-harness.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../shared/types';
import type { GroupedView } from '../data/use-stream-feed';
import { installGeometryStubs, mountStreamView } from '../shell/__fixtures__/stream-view-harness';

const { getSetting, setSetting, saveInputNote, carriedTagPaths } = vi.hoisted(() => ({
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async (_key: string, _value: string) => {}),
  saveInputNote: vi.fn(async (_s: string) => 1),
  carriedTagPaths: vi.fn(async (): Promise<string[]> => []),
}));
vi.mock('../../shared/api', () => ({ api: { getSetting, setSetting, saveInputNote, carriedTagPaths } }));

const GNOTE: Note = { id: 8, content: '分组里的一条', created_at: '2026-10-06 10:00:00', tags: ['地点/美国'], links: [] };
const view = (onToggle = vi.fn(), onLoadMore = vi.fn()): GroupedView => ({
  groups: [
    { key: '地点/美国', sessionKey: '地点/美国', label: '美国', count: 169, notes: [GNOTE], hasMore: true },
  ],
  collapsed: new Set<string>(),
  loadingGroup: null,
  onToggle,
  onLoadMore,
});

beforeEach(() => installGeometryStubs());
afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('NoteStream:分组渲染分支', () => {
  it('grouping 非空:渲染组头(组名 + 条数)与组内卡片,不再走平铺 ul 分支', async () => {
    const m = await mountStreamView({ notes: [GNOTE], grouping: view() });
    const header = m.host.querySelector('[data-testid="group-header"]') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.textContent).toContain('美国');
    expect(header.textContent).toContain('169 条');
    expect(m.host.querySelectorAll('[data-testid="group-section"]')).toHaveLength(1);
    expect(m.host.textContent).toContain('分组里的一条');
    m.unmount();
  });

  it('点组头回传组装线,点「加载更多」回传本组', async () => {
    const onToggle = vi.fn();
    const onLoadMore = vi.fn();
    const m = await mountStreamView({ notes: [GNOTE], grouping: view(onToggle, onLoadMore) });
    (m.host.querySelector('[data-testid="group-header"]') as HTMLElement).click();
    expect(onToggle).toHaveBeenCalledWith('地点/美国');
    (m.host.querySelector('[data-testid="group-more"]') as HTMLElement).click();
    expect(onLoadMore).toHaveBeenCalledWith('地点/美国');
    m.unmount();
  });

  it('grouping 为空:走平铺分支,没有组头', async () => {
    const m = await mountStreamView({ notes: [GNOTE] });
    expect(m.host.querySelector('[data-testid="group-header"]')).toBeNull();
    expect(m.host.querySelector('ul li')).not.toBeNull();
    m.unmount();
  });

  it('notice 非空:渲染顶部提示条(degraded / slow 文案)', async () => {
    const m = await mountStreamView({ notes: [GNOTE], notice: '结果很多，建议加筛选' });
    const bar = m.host.querySelector('[data-testid="stream-notice"]') as HTMLElement;
    expect(bar.textContent).toContain('结果很多，建议加筛选');
    m.unmount();
  });
});
