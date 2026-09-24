/**
 * 顶栏溢出菜单(Task 3):把「排序 / 导出全部 / 添加条件」的可见兜底收在 `⋯` 里 ——
 * 这三条动作的命令与执行通道早已在 `>` 里就绪(use-app-commands),这里只是鼠标入口 + 勾选态显示。
 *
 * 条目由调用方(App)用 `topBarMenuItems` 从**命令表**构造:标题、danger、勾选态(命令自己的
 * toggled 表达式)都不在本文件里重写,避免出现第二份文案与第二份排序口径。
 * 「正在导出 / 已导出」放在菜单外的 ExportNotice 里:点条目即关菜单,提示必须落在主窗上才看得见。
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { listCommands } from '../../shared/commands';
import type { FilterConditions } from '../../shared/filter-conditions';
import { defaultContext } from '../../shared/keys';
import { evaluate } from '../../shared/when';
import type { Context } from '../../shared/when';
import { sortContextKeys } from './use-main-palette';
import { useDismiss } from './use-dismiss';
import { BTN_ICON } from './button-classes';

export interface TopBarMenuItem {
  id: string;
  label: string;
  /** 有勾选态的条目(排序 ×2):true 才画勾,false 只占位;缺省 = 无勾选态的普通条目 */
  checked?: boolean;
  danger?: boolean;
  run: () => void;
}

// 视觉口径(V5 收口):rounded-xs(4px)+ text-ui(13/18)+ 中性 hover
const ITEM_CLASS = 'block w-full rounded-xs px-2 py-1.5 text-left text-ui hover:bg-hover';

/** 溢出菜单里的四条,按用户可见顺序:排序 ×2 -> 导出全部 -> 添加条件 */
const MENU_IDS = ['sort.newest', 'sort.oldest', 'export.all', 'filter.addCondition'] as const;

export interface TopBarMenuOptions {
  /** 当前排序(经 sortContextKeys 变成命令上下文的两键,勾选态由命令自身的 toggled 求值) */
  sort: FilterConditions['sort'];
  exporting: boolean;
  /** 执行通道:与 `>` 命令同一条(commands.execute,含 flush 编辑态与错误条) */
  run: (id: string) => void;
}

/** 从命令表构造条目:标题 / danger 用命令声明,toggled 求值成勾选态(不重写文案) */
export function topBarMenuItems(o: TopBarMenuOptions): TopBarMenuItem[] {
  const ctx: Context = { ...defaultContext(), ...sortContextKeys(o.sort) };
  const listed = listCommands(ctx);
  return MENU_IDS.flatMap((id) => {
    const cmd = listed.find((c) => c.id === id);
    if (cmd === undefined) return []; // when 不满足(当前三条恒真,导出恒真):整条不出现在菜单里
    const checked = cmd.toggled === undefined ? undefined : evaluate(cmd.toggled, ctx);
    const label = id === 'export.all' && o.exporting ? '导出中…' : cmd.title;
    return [{ id, label, checked, danger: cmd.danger, run: () => o.run(id) }];
  });
}

export function TopBarMenu(p: { items: readonly TopBarMenuItem[] }): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useDismiss(open, root, () => setOpen(false));

  return (
    <div ref={root} className="shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="更多操作"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        className={BTN_ICON}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          data-testid="topbar-menu"
          className="absolute right-2 top-10 z-20 w-52 rounded-lg border border-border bg-raised p-1 shadow-lg"
        >
          {p.items.map((item) => (
            <button
              key={item.id}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
              aria-checked={item.checked}
              onClick={() => {
                item.run();
                setOpen(false);
              }}
              className={ITEM_CLASS + (item.danger === true ? ' text-danger' : '')}
            >
              {item.checked !== undefined && (
                <span className="mr-1 inline-block h-3 w-3 align-[-2px]">
                  {item.checked && (
                    <svg viewBox="0 0 16 16" data-testid="topbar-menu-check" aria-hidden="true" className="h-3 w-3">
                      <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  )}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 导出反馈:菜单点完即关,「正在导出 / 已导出」落在顶栏(菜单外)才有意义 */
export function ExportNotice(p: { exporting: boolean; exported: boolean }): ReactNode {
  if (!p.exporting && !p.exported) return null;
  return (
    <span
      role="status"
      className={p.exporting ? 'text-ui text-muted' : 'text-ui text-success'}
    >
      {p.exporting ? '正在导出…' : '已导出'}
    </span>
  );
}
