/**
 * 侧栏单击的执行层(设计 2026-10-16 §2/§4,计划 T4):把行派发的 `RowIntent` 翻成「条件补丁 /
 * 预览卡片」两类副作用,并持有后者的会话内状态(**不落库**)。T1 算条件、T3 只派发意图、
 * T2 只渲染 —— 执行只有这一处;侧栏、设置页那一行与信息流首部的预览卡片共用本 hook 的产物。
 * 两处容易漏:`open` 模式下修饰键动作**一律**给回执、而 `filter` 只在"什么都没发生"时给
 * (§4.1「提示」列);路径从 `tagRows` 消失即清状态(§4.4)。
 * 2026-10-16 用户要求减为两档:原 `select` 的移光标 / 点空白清光标 / 光标条整条链路已删除。
 * 2026-10-17:预览卡片退到双击(`'open'` 根分支保留给 `dblIntent`),单击的 `'only'` 复用 `onlyThis`。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { filterKey, itemPaths } from '../../shared/filter-conditions';
import type { FilterConditions } from '../../shared/filter-conditions';
import type { TagCount } from '../../shared/types';
import type { TagPreviewCardProps } from '../shell/TagPreviewCard';
import { CLICK_MODE_LABELS, type SidebarClickMode } from './click-mode';
import { andAddTag, onlyThisTag, toggleExcludeTag } from './tag-click-patch';
import type { RowIntent } from './tag-row-action';
import { toggleTagPick, type TagNode } from './tag-tree';
import { useTagFlash, type TagFlashApi } from './use-tag-flash';
import type { SidebarStateApi } from './use-sidebar-state';

/** 切模式后的那句回执(§5.2):说清"下一次单击做什么" */
const MODE_ACTION: Record<SidebarClickMode, string> = {
  filter: '单击加入 / 移出筛选',
  open: '单击只看这一条、双击预览卡片',
};

export interface TagClickInput {
  conditions: FilterConditions;
  onPatch: (value: Partial<FilterConditions>) => void;
  /** 全量标签行:`preview` 的计数与"路径还在不在"的失效判定都用它 */
  rows: TagCount[];
  /** 当前是否在信息流视图:Esc 只在这里吃 */
  inStream: boolean;
  /** 切回信息流(open 意图用:卡片在流里) */
  openStream: () => void;
}

export interface TagClickApi extends TagFlashApi {
  /** 当前模式:头部按钮与设置页那一行的显示值(行也按它渲染) */
  clickMode: SidebarClickMode;
  /** 行意图的唯一执行入口(单击 / 双击 / Enter / Space 都由 T3 派发到这里);`expand` 归侧栏 */
  apply: (intent: RowIntent, node: TagNode) => void;
  /** 头部按钮 / 设置页:采纳新模式 + 关卡片 + 一句回执(§4.3 第 22 行) */
  changeClickMode: (m: SidebarClickMode) => void;
  /** 「只看这条」= 等价 Shift+单击(卡片共用一份实现,避免两套口径漂移) */
  onlyThis: (path: string) => void;
  previewPath: string | null;
  /** 预览卡片的渲染数据(可直接摊进对应组件);未打开时为 null */
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
    setPreview((v) => (v !== null && !paths.has(v) ? null : v));
  }, [paths]);

  // Esc:关卡片(§8 第 4-5 条)。只在信息流视图挂:设置页的 Esc 是「返回信息流」,不该顺带关卡片
  useEffect(() => {
    if (!inStream || previewPath === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inStream, previewPath]);

  /** 「只看这条」:清掉其余标签条件并给出回执(§3.3;可能一次清掉几条,没回执用户不知道) */
  const onlyThis = useCallback(
    (path: string) => {
      onPatch(onlyThisTag(conditions, path));
      showFlash(`已只看 #${path}`);
    },
    [conditions, onPatch, showFlash]
  );

  /** 行的业务意图(§4.1 主表);`expand` 归侧栏(折叠集合在那边),这里只防御性忽略 */
  const apply = useCallback(
    (intent: RowIntent, node: TagNode): void => {
      const path = node.path;
      /** open 模式:用户预期"点一下不会改条件",修饰键动作必须有一句话交代 */
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
      } else if (intent === 'exclude') {
        const was = itemPaths(conditions, 'excludeTag').includes(path);
        onPatch(toggleExcludeTag(conditions, path));
        echo(was ? `已移出排除：#${path}` : `已排除 #${path}`);
      } else if (intent === 'only') {
        onlyThis(path);
      } else if (intent === 'open') {
        // 2026-10-17:只有双击到得了这里(单击在 `open` 档已改走 `only`)
        if (previewPath === path) setPreview(null); // 再双击同一行 = 关闭(§2.3)
        else openPreview(path);
      }
    },
    [clickMode, conditions, onlyThis, onPatch, openPreview, previewPath, showFlash]
  );

  /** 切模式:采纳(落库由 setClickMode 负责)+ 关卡片 + 一句回执(§4.3 第 22 行) */
  const changeClickMode = useCallback(
    (m: SidebarClickMode) => {
      setClickMode(m);
      setPreview(null);
      showFlash(`已切到「${CLICK_MODE_LABELS[m]}」：${MODE_ACTION[m]}（Ctrl 追加 / Alt 排除 / Shift 只看这条）`);
    },
    [setClickMode, showFlash]
  );

  const byPath = useMemo(() => new Map(rows.map((r) => [r.path, r])), [rows]);
  const opened = previewPath === null ? undefined : byPath.get(previewPath);
  return {
    clickMode,
    previewPath,
    apply,
    changeClickMode,
    onlyThis,
    flash,
    showFlash,
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
