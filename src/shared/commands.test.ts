/**
 * 命令注册表:声明校验(重复 id / 缺标题)、when 过滤、别名命中、14 条命令的定型字段。
 * 命令清单见设计 §3.7(原 11 行 + 排序 ×2 + 添加条件;副作用由 T6/Task1 接线,此处只断言占位可识别)。
 */
import { describe, expect, it } from 'vitest';
import { CONTEXT, defaultContext } from './keys';
import {
  COMMANDS,
  defineCommands,
  findCommand,
  listCommands,
  withRuns,
  type CommandDef,
} from './commands';
import { serialize } from './when';
import type { Context } from './when';

const def = (id: string, extra: Partial<CommandDef> = {}): CommandDef => ({
  id,
  title: extra.title ?? id,
  ...extra,
});

/** 设计 §3.7 的定型表:id / 标题 / 别名(声明顺序即列表顺序) */
const EXPECTED: ReadonlyArray<{ id: string; title: string; aliases: string[] }> = [
  { id: 'note.new', title: '新建笔记', aliases: ['new', 'create', '写'] },
  { id: 'tab.next', title: '切换标签页(下一个)', aliases: ['tab', 'next'] },
  { id: 'tab.prev', title: '切换标签页(上一个)', aliases: ['tab', 'prev'] },
  { id: 'settings.open', title: '打开设置', aliases: ['settings', '偏好'] },
  { id: 'theme.cycle', title: '切换主题', aliases: ['theme', 'dark', '暗色'] },
  { id: 'sidebar.toggle', title: '隐藏侧栏 / 显示侧栏', aliases: ['sidebar'] },
  { id: 'focus.mode', title: '专注模式', aliases: ['zen', '专注'] },
  { id: 'sort.newest', title: '最新在前', aliases: ['最新', 'sort'] },
  { id: 'sort.oldest', title: '最早在前', aliases: ['最早'] },
  { id: 'filter.addCondition', title: '添加条件', aliases: ['筛选', '条件'] },
  { id: 'export.all', title: '导出整库', aliases: ['export', 'xlsx'] },
  { id: 'search.reindex', title: '重建搜索索引', aliases: ['reindex', 'fts'] },
  { id: 'hotkey.edit', title: '改全局热键', aliases: ['hotkey'] },
  { id: 'app.quit', title: '退出', aliases: ['quit', 'exit'] },
];

describe('commands:14 条命令的定型字段', () => {
  it('id 顺序即声明顺序,标题与别名逐条一致', () => {
    expect(COMMANDS.all.map((c) => c.id)).toEqual(EXPECTED.map((e) => e.id));
    for (const [i, want] of EXPECTED.entries()) {
      const cmd = COMMANDS.all[i];
      expect(cmd.title, want.id).toBe(want.title);
      expect([...cmd.aliases], want.id).toEqual(want.aliases);
    }
  });

  it('恒真命令默认全部可见;tab.next / tab.prev 只在多标签时出现', () => {
    const single = listCommands(defaultContext()).map((c) => c.id);
    expect(single).toEqual(EXPECTED.map((e) => e.id).filter((id) => !id.startsWith('tab.')));
    const many: Context = { ...defaultContext(), 'tab.multiple': true };
    const ids = listCommands(many).map((c) => c.id);
    expect(ids).toContain('tab.next');
    expect(ids).toContain('tab.prev');
    expect(findCommand('tab.next')?.when).toEqual(CONTEXT.tabMultiple.equals(true));
    expect(findCommand('tab.prev')?.when).toEqual(CONTEXT.tabMultiple.equals(true));
  });

  it('sidebar.toggle:勾选态由 sidebar 键驱动(equals,非裸键);danger 只有三条副作用命令', () => {
    const toggle = findCommand('sidebar.toggle');
    expect(toggle?.toggled).toEqual(CONTEXT.sidebar.equals(true));
    expect(toggle?.danger).toBe(false);
    const danger = COMMANDS.all.filter((c) => c.danger).map((c) => c.id);
    expect(danger).toEqual(['export.all', 'search.reindex', 'app.quit']);
    for (const cmd of COMMANDS.all) {
      if (!danger.includes(cmd.id)) expect(cmd.danger, cmd.id).toBe(false);
    }
  });

  it('tab.count 只作数据:任何命令的 when/toggled 都不得引用它', () => {
    for (const cmd of COMMANDS.all) {
      expect(serialize(cmd.when), cmd.id).not.toContain('tab.count');
      if (cmd.toggled) expect(serialize(cmd.toggled), cmd.id).not.toContain('tab.count');
    }
  });

  it('run 是 T6 前的占位:调用即抛中文「未接线」', () => {
    for (const cmd of COMMANDS.all) expect(() => cmd.run(), cmd.id).toThrow(/未接线/);
  });

  it('命令对象与注册表冻结;listCommands 顺序稳定', () => {
    expect(Object.isFrozen(COMMANDS.all)).toBe(true);
    for (const cmd of COMMANDS.all) expect(Object.isFrozen(cmd), cmd.id).toBe(true);
    expect(listCommands(defaultContext()).map((c) => c.id)).toEqual(
      listCommands(defaultContext()).map((c) => c.id),
    );
    expect(findCommand('nope')).toBeUndefined();
  });
});

describe('commands:defineCommands 校验', () => {
  it('重复 id 抛错(trim 后相同也算重复)', () => {
    expect(() => defineCommands([def('a'), def('a')])).toThrow(/重复/);
    expect(() => defineCommands([def(' a'), def('a ')])).toThrow(/重复/);
  });

  it('空 id / 空标题抛中文错误,id 与标题都会被 trim', () => {
    expect(() => defineCommands([def('  ')])).toThrow(/id/);
    expect(() => defineCommands([{ id: 'a', title: '   ' }])).toThrow(/标题/);
    const reg = defineCommands([def(' a ', { title: ' 打招呼 ' })]);
    expect(reg.all[0].id).toBe('a');
    expect(reg.all[0].title).toBe('打招呼');
  });

  it('when 缺省即恒真;when 为假不进列表;find 按 id', () => {
    const reg = defineCommands([
      def('always'),
      def('editing', { when: CONTEXT.editing.equals(true) }),
    ]);
    expect(reg.list({}).map((c) => c.id)).toEqual(['always']);
    expect(reg.list({ editing: true }).map((c) => c.id)).toEqual(['always', 'editing']);
    expect(reg.find('editing')?.id).toBe('editing');
    expect(reg.find('missing')).toBeUndefined();
  });

  it('别名去空白并丢弃空串;声明顺序保留', () => {
    const reg = defineCommands([def('quit', { title: '退出', aliases: [' quit ', ''] })]);
    expect([...reg.all[0].aliases]).toEqual(['quit']);
  });
});

describe('commands:withRuns 接线门禁(T6,T3 审查 Important 1)', () => {
  /** 把 14 条命令全部接上(可逐条替换实现,便于断言注入的就是这份) */
  const fullRuns = (over: Record<string, () => void> = {}): Record<string, () => void> =>
    Object.fromEntries(COMMANDS.all.map((c) => [c.id, over[c.id] ?? (() => {})]));

  it('全部 id 都接线时构造成功,run 就是注入的那一份', () => {
    const calls: string[] = [];
    const wired = withRuns(
      COMMANDS,
      Object.fromEntries(COMMANDS.all.map((c) => [c.id, () => {
        calls.push(c.id);
      }])),
    );
    expect(wired.all.map((c) => c.id)).toEqual(COMMANDS.all.map((c) => c.id));
    wired.find('app.quit')!.run();
    wired.find('note.new')!.run();
    expect(calls).toEqual(['app.quit', 'note.new']);
  });

  it('缺 id 即抛中文错误,并列出全部缺失的 id(漏接不再是静默占位)', () => {
    const missing = fullRuns();
    delete missing['export.all'];
    delete missing['app.quit'];
    expect(() => withRuns(COMMANDS, missing)).toThrow(/未接线/);
    expect(() => withRuns(COMMANDS, missing)).toThrow(/export\.all/);
    expect(() => withRuns(COMMANDS, missing)).toThrow(/app\.quit/);
  });

  it('接线后的注册表不再保留占位(run 调用不抛未接线)', () => {
    const wired = withRuns(COMMANDS, fullRuns());
    for (const cmd of wired.all) expect(() => cmd.run(), cmd.id).not.toThrow(/未接线/);
    expect(findCommand('note.new')?.id).toBe('note.new');
  });
});
