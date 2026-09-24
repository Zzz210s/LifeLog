import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FilterConditions } from '../../shared/filter-conditions';
import { useDismiss } from '../shell/use-dismiss';

export interface AddConditionMenuProps {
  conditions: FilterConditions;
  /** 局部更新(有无标签/排序在菜单内直接生效) */
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 标签/排除标签:交给上层打开标签选择器 */
  onPickTag: (exclude: boolean) => void;
  /** 表达式(高级):交给上层打开表达式对话框(D4:只在筛选栏编辑) */
  onOpenExpr: () => void;
  /** 受控开关:命令与顶栏菜单(Task 3)、条件栏都把开关放在上层 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 是否渲染「添加条件」按钮:条件栏里鼠标入口已搬到顶栏菜单,只留浮层(默认渲染) */
  showTrigger?: boolean;
}

type Pane = 'main' | 'presence' | 'sort';

const ITEM_CLASS =
  'block w-full rounded-xs px-2.5 py-1.5 text-left text-ui text-muted hover:bg-accent-soft hover:text-accent-text';

/** 「添加条件」下拉:主面板五项(无日期入口,spec D2);有无标签/排序切换到子面板直接生效。
 * 开关受控(open/onOpenChange),方便 `>` 命令与顶栏菜单从别处打开它;`showTrigger=false` 时只渲染浮层。 */
export function AddConditionMenu(p: AddConditionMenuProps): ReactNode {
  const [pane, setPane] = useState<Pane>('main');
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
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => act(() => p.onPickTag(false))}>
                标签
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => act(() => p.onPickTag(true))}>
                排除标签
              </button>
              <button type="button" role="menuitem" className={ITEM_CLASS} onClick={() => setPane('presence')}>
                有无标签
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
                ['none', '无自定义标签'],
              ] as const).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitem"
                  className={ITEM_CLASS + (p.conditions.tagPresence === v ? ' bg-accent-soft text-accent-text' : '')}
                  onClick={() => act(() => p.onPatch({ tagPresence: v }))}
                >
                  {label}
                </button>
              ))}
            </>
          )}
          {pane === 'sort' && (
            <>
              {(['newest', 'oldest'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="menuitem"
                  className={ITEM_CLASS + (p.conditions.sort === v ? ' bg-accent-soft text-accent-text' : '')}
                  onClick={() => act(() => p.onPatch({ sort: v }))}
                >
                  {v === 'newest' ? '最新在前' : '最早在前'}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
