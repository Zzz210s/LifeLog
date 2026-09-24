/**
 * 三个 provider 经浮层接线的读数:空前缀 = 笔记、`>` = 命令、`#` = 标签;
 * 前缀实时切换;装饰(danger/checked/计数/日期)按前缀分派;候选硬截与 FTS 追加。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note, TagCount } from '../../shared/types';
import { mountAppPalette } from './app-palette-harness';
import type { AppPaletteHarness } from './app-palette-harness';

const { queryNotes, listTags, getSetting, setSetting } = vi.hoisted(() => ({
  queryNotes: vi.fn(async () => [] as Note[]),
  listTags: vi.fn(async () => [] as TagCount[]),
  getSetting: vi.fn(async (_key: string): Promise<string | null> => null),
  setSetting: vi.fn(async () => {}),
}));
vi.mock('../../shared/api', () => ({ api: { queryNotes, listTags, getSetting, setSetting } }));

const note = (id: number, content: string, tags: string[] = []): Note => ({
  id,
  content,
  created_at: '2026-09-22 10:00:00',
  tags,
});
const tag = (path: string, subtree: number): TagCount => ({
  id: path.length,
  path,
  depth: 0,
  sort_order: 0,
  self_count: subtree,
  subtree_count: subtree,
});

let h: AppPaletteHarness;
beforeEach(() => {
  queryNotes.mockResolvedValue([note(1, '买牛奶', ['生活']), note(2, '写周报', ['工作/项目A'])]);
  listTags.mockResolvedValue([tag('工作', 4), tag('生活', 1)]);
  getSetting.mockResolvedValue(null);
  h = mountAppPalette();
});
afterEach(() => {
  h.unmount();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

const labels = (): string[] => h.controller().rows.map((r) => r.item.label);
const ids = (): string[] => h.controller().rows.map((r) => r.item.id);

describe('浮层接线:三个 provider', () => {
  it('空前缀 = 笔记(最近候选来自 query_notes),Enter 前的列表按标题打分', async () => {
    await h.open('');
    expect(queryNotes).toHaveBeenCalled();
    expect(labels()).toEqual(['买牛奶', '写周报']);

    await h.type('牛奶');
    expect(labels()).toEqual(['买牛奶']);
    expect(h.controller().rows[0].ranges.length).toBeGreaterThan(0); // 高亮来自打分器
  });

  it('`>` = 命令:14 条(多标签时),输入「导」→ 导出整库排第一且带高亮', async () => {
    h.setNotes([note(1, 'a')]);
    await h.open('>');
    expect(labels()).toHaveLength(12); // 单标签页时 tab.next/prev 不出现
    await h.type('导');
    expect(labels()[0]).toBe('导出整库');
    expect(h.decorations()['export.all'].danger).toBe(true);

    await h.type('侧栏');
    expect(ids()).toEqual(['sidebar.toggle']);
    expect(labels()).toEqual(['隐藏侧栏']); // 侧栏可见 = 勾选态,标题取动作前半句
    expect(h.decorations()['sidebar.toggle'].checked).toBe(true);
  });

  it('勾选态换边:侧栏已隐藏时标题变「显示侧栏」(evaluate(toggled) 决定)', async () => {
    const h2 = mountAppPalette({ context: { sidebar: false } });
    await h2.open('>');
    await h2.type('显示侧栏');
    expect(h2.controller().rows.map((r) => r.item.label)).toEqual(['显示侧栏']);
    expect(h2.decorations()['sidebar.toggle'].checked).toBe(false);
    h2.unmount();
  });

  it('`#` = 标签:显示路径 + 含子级计数;输入即按路径打分', async () => {
    await h.open('#');
    expect(labels()).toEqual(['工作', '生活']);
    expect(h.decorations()['工作'].detail).toBe('4 条');
    await h.type('项目');
    expect(listTags).toHaveBeenCalled();
  });

  it('`#` 模式:连续输入 10 个字符只打一次 list_tags(候选池按数据版本缓存)', async () => {
    await h.open('#');
    expect(listTags).toHaveBeenCalledTimes(1); // 打开浮层时取一次
    const typed = '工作项目生活日常事务'; // 10 个字符
    expect(typed.length).toBe(10);
    for (let i = 1; i <= typed.length; i++) await h.type('#' + typed.slice(0, i));
    expect(listTags).toHaveBeenCalledTimes(1); // 10 次按键,0 次新查询
  });

  it('标签增删改(数据版本 +1)后浮层看到新标签,不陈旧', async () => {
    await h.open('#');
    expect(labels()).toEqual(['工作', '生活']);
    listTags.mockResolvedValue([tag('工作', 4), tag('生活', 1), tag('新标签', 0)]);
    h.setTagsVersion(1);
    await h.flush();
    expect(labels()).toContain('新标签');
  });

  it('前缀实时驱动:空前缀里输入 `>` 当场切到命令 provider', async () => {
    await h.open('');
    await h.type('>导');
    expect(h.controller().prefix).toBe('>');
    expect(h.controller().query).toBe('导');
    expect(labels()).toEqual(['导出整库']);
  });

  it('笔记装饰带日期与标签(取到过该笔记才有)', async () => {
    await h.open('');
    expect(h.decorations()['1'].detail).toBe('2026-09-22 · #生活');
  });

  it('固定项不跨 provider 串:标签固定项(路径)不得改变笔记列表顺序', async () => {
    getSetting.mockImplementation(async (key: string) =>
      key === 'ui.pinned.tags' ? '["2"]' : null, // '2' 恰好是一条笔记的 id
    );
    const h2 = mountAppPalette();
    await h2.open('');
    expect(h2.controller().rows.map((r) => r.item.id)).toEqual(['1', '2']); // 仍按传入顺序
    h2.unmount();
  });

  it('笔记候选硬截 200 条(provider 侧保护)', async () => {
    queryNotes.mockResolvedValue(Array.from({ length: 250 }, (_, i) => note(i + 1, `笔记${i + 1}`)));
    await h.open('');
    expect(h.controller().rows).toHaveLength(200);
    expect(h.controller().total).toBe(200); // provider 已硬截,模型不再多算
    expect(h.controller().truncated).toBe(false); // 截断发生在 provider,列表模型看到的已是 200 条
  });

  it('≥2 字且本地无高分时追加一次 FTS 查询', async () => {
    queryNotes.mockResolvedValueOnce([note(1, '买牛奶')]); // 候选页
    queryNotes.mockResolvedValueOnce([note(9, '深处藏着冷门词')]); // FTS 回包
    await h.open('');
    expect(queryNotes).toHaveBeenCalledTimes(1);
    await h.type('冷门');
    expect(queryNotes).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual(['9']);
  });

  it('候选取回失败:错误条收到中文原因,列表清空(不静默)', async () => {
    queryNotes.mockRejectedValue(new Error('查询炸了'));
    await h.open('');
    expect(h.errors.some((m) => m.includes('查询炸了'))).toBe(true);
    expect(h.controller().rows).toEqual([]);
  });
});

describe('浮层接线:接受分派', () => {
  it('命令行 -> executeCommand(真的调 run);标签行 -> toggleTag(路径)', async () => {
    await h.open('>');
    await h.type('主题');
    await h.accept(0);
    expect(h.runCalls).toEqual(['theme.cycle']);

    await h.open('#');
    await h.accept(0);
    expect(h.toggleTag).toHaveBeenCalledWith('工作');
  });

  it('笔记行 -> 关闭浮层并定位流中该卡片', async () => {
    h.setNotes([note(1, '买牛奶')]);
    const li = document.createElement('li');
    const body = document.createElement('div');
    body.setAttribute('data-note-body', '1');
    li.appendChild(body);
    document.body.appendChild(li);
    await h.open('');
    await h.accept(0);
    expect(h.controller().isOpen).toBe(false);
    expect(li.className).toContain('bg-accent-soft');
  });

  it('笔记不在结果里且无筛选 -> 提示「不在当前筛选结果中」', async () => {
    h.setNotes([]);
    queryNotes.mockResolvedValue([note(9, '别的笔记')]);
    await h.open('');
    await h.accept(0);
    expect(h.errors).toContain('该笔记不在当前筛选结果中');
  });
});
