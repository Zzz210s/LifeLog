import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { addGroupItem, migrateFlat, uiGroups } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import { useDismiss } from '../shell/use-dismiss';
import { SortPanel } from './SortPanel';

export interface AddConditionMenuProps {
  conditions: FilterConditions;
  /** 局部更新(有无标签/排序/新建条件组在菜单内直接生效) */
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 标签/排除标签:交给上层打开标签选择器;group = 落笔到第几组 */
  onPickTag: (exclude: boolean, group: number) => void;
  /** 关系/排除关系(设计 2026-10-06 §10 R10b):交给上层打开关系选择器;group = 落笔到第几组 */
  onPickRelation: (exclude: boolean, group: number) => void;
  /** 表达式(高级):交给上层打开表达式对话框(D4:只在筛选栏编辑) */
  onOpenExpr: () => void;
  /** 受控开关:命令与顶栏菜单(Task 3)、条件栏都把开关放在上层 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 是否渲染「添加条件」按钮:条件栏里鼠标入口已搬到顶栏菜单,只留浮层(默认渲染) */
  showTrigger?: boolean;
}

type Pane = 'main' | 'presence' | 'sort' | 'group';

const ITEM_CLASS =
  'block w-full rounded-xs px-2.5 py-1.5 text-left text-ui text-muted hover:bg-accent-soft hover:text-accent-text';

/** 「添加条件」下拉:主面板六项(无日期入口,spec D2);有无标签/排序/条件组切换到子面板直接生效。
 * 开关受控(open/onOpenChange),方便 `>` 命令与顶栏菜单从别处打开它;`showTrigger=false` 时只渲染浮层。
 * 条件组(设计 2026-10-06 §5.5):「条件组」子面板选**落笔到第几组**(或新建一组),
 * 主面板的标签/关系/有无标签就落进那一组;组内 / 组间 且或 的切换在条件栏的组头上。 */
export function AddConditionMenu(p: AddConditionMenuProps): ReactNode {
  const [pane, setPane] = useState<Pane>('main');
  const [target, setTarget] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  // props 现读:菜单的关闭/选择回调可能很晚才跑,不能闭包住旧 props
  const latest = useRef(p);
  latest.current = p;

  // 开着时:点击菜单外或 Esc 关闭(共用写法见 shell/use-dismiss)
  useDismiss(p.open, root, () => latest.current.onOpenChange(false));

  const close = () => {
    latest.current.onOpenChange(false);
    setPane('main');
  };
  const act = (fn: () => void) => {
    fn();
    close();
  };
  const groups = uiGroups(p.conditions);
  // 组被删掉后目标越界 -> 回落到最后一组(越界=新建组的语义仍由 addGroupItem 兜底)
  const group = Math.min(target, groups.length);
  // 有无标签在组内唯一:先清掉所有 presence 项再落新的
  const clearPresence = (c: FilterConditions): FilterConditions => {
    const m = migrateFlat(c);
    return {
      ...m,
      groups: m.groups.map((g) => ({
        ...g,
        items: g.items.filter((it) => it.kind !== 'presence'),
      })),
    };
  };

  return (
    <div ref={root} className="relative shrink-0">
      {p.showTrigger !== false && (
        <button
          type="button"
          onClick={() => p.onOpenChange(!p.open)}
          aria-haspopup="menu"
          aria-expanded={p.open}
          className="h-8 rounded-sm border border-border px-2.5 text-ui text-muted hover:border-accent hover:text-accent-text"
        >
          添加条件
          <svg viewBox="0 0 16 16" className="ml-1 inline h-3 w-3 align-[-1px]" aria-hidden="true">
            <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      )}
      {p.open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-20 mt-1 rounded-lg border border-border bg-raised p-1 shadow-lg"
        >
          {pane === 'main' && (
            <>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => act(() => p.onPickTag(false, group))}>
                标签
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => act(() => p.onPickTag(true, group))}>
                排除标签
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => act(() => p.onPickRelation(false, group))}>
                关系
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => act(() => p.onPickRelation(true, group))}>
                排除关系
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => setPane('presence')}>
                有无标签
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => setPane('group')}>
                条件组
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => setPane('sort')}>
                排序
              </button>
              <button
                type="button"
                role="menuitem"
                className={ITEM_CLASS}
                onClick={() => act(() => p.onOpenExpr())}
              >
                表达式(高级)
              </button>
            </>
          )}
          {pane === 'presence' && (
            <>
              {([
                [null, '不限'],
                ['any', '有标签'],
                ['none', '无标签'],
              ] as const).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  className={ITEM_CLASS}
                  onClick={() =>
                    act(() =>
                      p.onPatch(
                        v === null
                          ? clearPresence(p.conditions)
                          : addGroupItem(clearPresence(p.conditions), { kind: 'presence', value: v }, group)
                      )
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </>
          )}
          {pane === 'group' && (
            <>
              <div className="px-2.5 py-1 text-micro text-muted">条件落进哪一组</div>
              {groups.map((g, gi) => (
                <button
                  key={gi}
                  type="button"
                  role="menuitem"
                  className={ITEM_CLASS + (gi === group ? ' bg-accent-soft text-accent-text' : '')}
                  onClick={() => {
                    setTarget(gi);
                    setPane('main');
                  }}
                >
                  {`第 ${gi + 1} 组（组内${g.op === 'and' ? '且' : '或'}，${g.items.length} 项）`}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className={ITEM_CLASS + (group >= groups.length ? ' bg-accent-soft text-accent-text' : '')}
                onClick={() => {
                  setTarget(groups.length);
                  setPane('main');
                }}
              >
                新建一组（下一个条件进新组）
              </button>
            </>
          )}
          {pane === 'sort' && <SortPanel conditions={p.conditions} onPatch={p.onPatch} />}
        </div>
      )}
    </div>
  );
}
