/**
 * 命令 provider 测试:when 过滤、标题/别名两档打分、勾选态标题两半、装饰(danger/checked)。
 */
import { describe, expect, it } from 'vitest';
import { COMMANDS, defineCommands, withRuns } from '../../../shared/commands';
import type { CommandRegistry } from '../../../shared/commands';
import { defaultContext } from '../../../shared/keys';
import { LABEL_MATCH_BOOST, LABEL_PREFIX_BOOST, PATH_BOOST } from '../../../shared/fuzzy-score';
import type { Context } from '../../../shared/when';
import { commandDecorations, commandItems, resolveCommandTitle, scoreCommand } from './commands';
import type { Command } from '../../../shared/commands';

const wired = (): CommandRegistry => withRuns(COMMANDS, Object.fromEntries(COMMANDS.all.map((c) => [c.id, () => {}])));

const byte = (over: Partial<Context> = {}): Context => ({ ...defaultContext(), ...over });

describe('commands provider:when 过滤与条数', () => {
  it('12 条命令全在:顺序即声明顺序;已删的标签页命令不再出现', () => {
    const reg = wired();
    const items = commandItems(reg, byte(), '');
    expect(items).toHaveLength(12);
    expect(items.map((i) => i.id)).toEqual(COMMANDS.all.map((c) => c.id));
    expect(items.some((i) => i.id.startsWith('tab.'))).toBe(false);
  });

  it('空查询不预置分数(交给列表模型走「固定 -> 最近 -> 全量」)', () => {
    for (const item of commandItems(wired(), byte(), '')) {
      expect(item.score).toBeUndefined();
      expect(item.positions).toBeUndefined();
    }
  });
});

describe('commands provider:标题与别名两档', () => {
  const reg = defineCommands([
    { id: 'export.all', title: '导出整库', aliases: ['export', 'xlsx'] },
    { id: 'theme.cycle', title: '切换主题', aliases: ['theme', 'dark', '暗色'] },
  ]);

  it('标题命中用 PATH_BOOST 档,别名命中用 LABEL_* 档,标题档更高', () => {
    const titleHit = scoreCommand(reg.find('export.all')! as Command, byte(), '导出');
    expect(titleHit?.score).toBeGreaterThanOrEqual(PATH_BOOST);
    expect(titleHit?.positions.length).toBeGreaterThan(0); // 标题命中给高亮

    const aliasHit = scoreCommand(reg.find('export.all')! as Command, byte(), 'xlsx');
    expect(aliasHit?.score).toBeLessThan(PATH_BOOST);
    expect(aliasHit?.score).toBeGreaterThanOrEqual(LABEL_MATCH_BOOST);
    expect(aliasHit?.positions).toEqual([]); // 别名位置不映射到标题,不高亮
  });

  it('别名前缀命中走 LABEL_PREFIX_BOOST 档(高于包含命中)', () => {
    const prefix = scoreCommand(reg.find('export.all')! as Command, byte(), 'exp');
    const contains = scoreCommand(reg.find('export.all')! as Command, byte(), 'xpo'); // 子串但不是前缀
    expect(prefix!.score - LABEL_PREFIX_BOOST).toBeGreaterThanOrEqual(0);
    expect(prefix!.score).toBeGreaterThan(contains!.score);
  });

  it('未命中的命令不出现在结果里;中文别名可命中', () => {
    const items = commandItems(reg, byte(), '暗色');
    expect(items.map((i) => i.id)).toEqual(['theme.cycle']);
    expect(commandItems(reg, byte(), 'zzzz')).toEqual([]);
  });
});

describe('commands provider:勾选态标题两半与装饰', () => {
  it('sidebar.toggle:勾选(侧栏可见)= 动作「隐藏侧栏」;未勾选 = 「显示侧栏」', () => {
    const cmd = COMMANDS.find('sidebar.toggle')!;
    expect(resolveCommandTitle(cmd, byte({ sidebar: true }))).toBe('隐藏侧栏');
    expect(resolveCommandTitle(cmd, byte({ sidebar: false }))).toBe('显示侧栏');
    expect(resolveCommandTitle(COMMANDS.find('note.new')!, byte())).toBe('新建笔记');
  });

  it('标题两半都可被搜到(打分用解析后的标题)', () => {
    const items = commandItems(wired(), byte({ sidebar: false }), '显示侧栏');
    expect(items.map((i) => i.id)).toEqual(['sidebar.toggle']);
    expect(items[0].label).toBe('显示侧栏');
  });

  it('装饰:危险命令标 danger,勾选态命令按上下文标 checked', () => {
    const deco = commandDecorations(wired(), byte({ sidebar: true }));
    expect(deco['export.all'].danger).toBe(true);
    expect(deco['search.reindex'].danger).toBe(true);
    expect(deco['app.quit'].danger).toBe(true);
    expect(deco['note.new'].danger).toBeUndefined();
    expect(deco['sidebar.toggle'].checked).toBe(true);
    expect(commandDecorations(wired(), byte({ sidebar: false }))['sidebar.toggle'].checked).toBe(false);
    expect(deco['note.new'].checked).toBeUndefined();
  });
});
