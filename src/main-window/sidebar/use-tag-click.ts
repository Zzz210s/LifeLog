/**
 * 侧栏单击的执行层(设计 2026-10-16 §2/§4,计划 T4):把行派发的 `RowIntent` 翻成「条件补丁 /
 * 光标 / 预览卡片」三类副作用,并持有后两者的会话内状态(**不落库**)。T1 算条件、T3 只派发意图、
 * T2 只渲染 —— 执行只有这一处;侧栏、设置页那一行与信息流首部的预览卡片共用本 hook 的产物。
 * 三处容易漏:`select` 不写任何条件(§2.2.1);`select` / `open` 模式下修饰键动作**一律**给回执、
 * 而 `filter` 只在"什么都没发生"时给(§4.1「提示」列);路径从 `tagRows` 消失即清状态(§4.4)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { filterKey, itemPaths } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import type { TagPreviewCardProps } from '../shell/TagPreviewCard';
import type { TagCursorBarProps } from './TagCursorBar';
import { CLICK_MODE_LABELS, type SidebarClickMode } from './click-mode';
import { andAddTag, onlyThisTag, toggleExcludeTag } from './tag-click-patch';
import type { RowIntent } from './tag-row-action';
import { toggleTagPick, type TagNode } from './tag-tree';
import { useTagFlash, type TagFlashApi } from './use-tag-flash';
import type { SidebarStateApi } from './use-sidebar-state';

/** 切模式后的那句回执(§5.2):说清"下一次单击做什么" */
const MODE_ACTION: Record<SidebarClickMode, string> = {
  filter: '单击加入 / 移出筛选',
  open: '单击打开实体',
  select: '单击选中实体',
};

export interface TagClickInput {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 全量标签行:`cursor` / `preview` 的两个计数与"路径还在不在"的失效判定都用它 */
  rows: TagCount[];
  /** 当前是否在信息流视图:Esc 只在这里吃 */
  inStream: boolean;
  /** 切回信息流(open 意图用:卡片在流里) */
  openStream: () => void;
}

export interface TagClickApi extends TagFlashApi {
  /** 当前模式:头部按钮与设置页那一行的显示值(行与光标条也按它渲染) */
  clickMode: SidebarClickMode;
  /** 行意图的唯一执行入口(单击 / 双击 / Enter / Space 都由 T3 派发到这里);`expand` 归侧栏 */
  apply: (intent: RowIntent, node: TagNode) => void;
  /** 点侧栏列表空白 = 清光标(只有列表容器自己收到点击才算,§4.3 第 21 行) */
  onListBlankClick: (e: ReactMouseEvent) => void;
  /** 头部按钮 / 设置页:采纳新模式 + 清光标与卡片 + 一句回执(§4.3 第 22 行) */
  changeClickMode: (m: SidebarClickMode) => void;
  /** 「只看这条」= 等价 Shift+单击(光标条与卡片共用一份实现,避免两套口径漂移) */
  onlyThis: (path: string) => void;
  cursorPath: string | null;
  previewPath: string | null;
  /** 光标条 / 预览卡片的渲染数据(可直接摊进对应组件);未选中 / 未打开时为 null */
  cursor: TagCursorBarProps | null;
  preview: TagPreviewCardProps | null;
}

/** TagCount 行 -> 两个计数的渲染数据 */
const counts = (row: TagCount) => ({
  path: row.path,
  selfCount: row.self_count,
  subtreeCount: row.subtree_count,
});

export function useTagClick(
  /** 侧栏状态(模式真源):`clickMode` 读,`setClickMode` 在切模式时采纳并落库 */
  sidebar: Pick<SidebarStateApi, 'clickMode' | 'setClickMode'>,
  p: TagClickInput
): TagClickApi {
  const { conditions, onPatch, rows, inStream, openStream } = p;
  const { clickMode, setClickMode } = sidebar;
  const [cursorPath, setCursor] = useState<string | null>(null);
  const [previewPath, setPreview] = useState<string | null>(null);
  const { flash, showFlash } = useTagFlash();

  const openPreview = useCallback(
    (path: string) => {
      setPreview(path);
      openStream(); // 卡片在流里,不切用户看不见(§7.1 方案 a)
    },
    [openStream]
  );

  // 状态失效(§4.4):引用的路径已不在 tagRows 里(标签被删 / 改名)-> 清掉,不留悬空 UI
  const paths = useMemo(() => new Set(rows.map((r) => r.path)), [rows]);
  useEffect(() => {
    setCursor((c) => (c !== null && !paths.has(c) ? null : c));
    setPreview((v) => (v !== null && !paths.has(v) ? null : v));
  }, [paths]);

  // Esc:关卡片 / 清光标(§8 第 4-5 条)。只在信息流视图挂:设置页的 Esc 是「返回信息流」,不该顺带关卡片
  useEffect(() => {
    if (!inStream || (cursorPath === null && previewPath === null)) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setCursor(null);
      setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inStream, cursorPath, previewPath]);

  /** 「只看这条」:清掉其余标签条件并给出回执(§3.3;可能一次清掉几条,没回执用户不知道) */
  const onlyThis = useCallback(
    (path: string) => {
      onPatch(onlyThisTag(conditions, path));
      showFlash(`已只看 #${path}`);
    },
    [conditions, onPatch, showFlash]
  );

  /** 行的六个业务意图(§4.1 主表);`expand` 归侧栏(折叠集合在那边),这里只防御性忽略 */
  const apply = useCallback(
    (intent: RowIntent, node: TagNode): void => {
      const path = node.path;
      /** select 模式下任何单击都把光标移到该行(§4.1 第 5-8 行) */
      const toCursor = (): void => { if (clickMode === 'select') setCursor(path); };
      /** select / open 模式:用户预期"点一下不会改条件",修饰键动作必须有一句话交代 */
      const echo = (text: string): void => { if (clickMode !== 'filter') showFlash(text); };
      if (intent === 'toggle') {
        onPatch(toggleTagPick(conditions, path));
      } else if (intent === 'andAdd') {
        const next = andAddTag(conditions, path);
        if (filterKey(next) === filterKey(conditions)) showFlash(`已在筛选中：#${path}`);
        else {
          onPatch(next);
          echo(`已追加为同时满足：#${path}`);
        }
        toCursor();
      } else if (intent === 'exclude') {
        const was = itemPaths(conditions, 'excludeTag').includes(path);
        onPatch(toggleExcludeTag(conditions, path));
        echo(was ? `已移出排除：#${path}` : `已排除 #${path}`);
        toCursor();
      } else if (intent === 'only') {
        onlyThis(path);
        toCursor();
      } else if (intent === 'select') {
        setCursor(cursorPath === path ? null : path); // 再点同一行 = 清除(§2.2)
      } else if (intent === 'open') {
        if (previewPath === path) setPreview(null); // 再点同一行 = 关闭(§2.3)
        else openPreview(path);
      }
    },
    [clickMode, conditions, cursorPath, onlyThis, onPatch, openPreview, previewPath, showFlash]
  );

  /** 点空白:只有列表容器自己收到这次 click 才算(行上的点击会冒泡上来,`target` 不是容器) */
  const onListBlankClick = useCallback(
    (e: ReactMouseEvent) => {
      if (e.target !== e.currentTarget || clickMode !== 'select') return;
      setCursor(null);
    },
    [clickMode]
  );

  /** 切模式:采纳(落库由 setClickMode 负责)+ 清光标与卡片 + 一句回执(§4.3 第 22 行) */
  const changeClickMode = useCallback(
    (m: SidebarClickMode) => {
      setClickMode(m);
      setCursor(null);
      setPreview(null);
      showFlash(`已切到「${CLICK_MODE_LABELS[m]}」：${MODE_ACTION[m]}（Ctrl 追加 / Alt 排除 / Shift 只看这条）`);
    },
    [setClickMode, showFlash]
  );

  const byPath = useMemo(() => new Map(rows.map((r) => [r.path, r])), [rows]);
  const at = (path: string | null): TagCount | undefined => (path === null ? undefined : byPath.get(path));
  const shown = at(cursorPath);
  const opened = at(previewPath);
  return {
    clickMode,
    cursorPath,
    previewPath,
    apply,
    onListBlankClick,
    changeClickMode,
    onlyThis,
    flash,
    showFlash,
    cursor:
      shown === undefined
        ? null
        : { ...counts(shown), onOnlyThis: () => onlyThis(shown.path), onClear: () => setCursor(null) },
    preview:
      opened === undefined
        ? null
        : {
            ...counts(opened),
            // 卡片里的「只看这条」= 筛到流并关卡片(§5.4)
            onOnlyThis: () => {
              onlyThis(opened.path);
              setPreview(null);
            },
            onClose: () => setPreview(null),
          },
  };
}
