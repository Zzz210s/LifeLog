/**
 * 侧栏状态与持久化(spec 6.1):整栏显隐、宽度(180-420 钳制)、标签树/扁平模式、
 * 标签树里是否显示关系(标签关系统一 spec §7,**默认开**)。
 * 四个设置键 sidebar_visible / sidebar_width / tag_view_mode / tag_tree_show_relations;
 * 读取失败或非法值一律回默认。
 * **不回读旧键** tag_tree_show_carry:那是「携带」时代的开关,与现在的「关系」不是一回事 ——
 * 2026-10-06 真库里旧键恰好显式存着 `false`,回读会让默认值永远显示不出来;旧键行留在库里不动。
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';

export type TagViewMode = 'tree' | 'flat';

/** 宽度钳制范围(与 spec 6.1 一致) */
export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 420;
const DEFAULT_WIDTH = 240;

const KEY_VISIBLE = 'sidebar_visible';
const KEY_WIDTH = 'sidebar_width';
const KEY_MODE = 'tag_view_mode';
const KEY_SHOW_RELATIONS = 'tag_tree_show_relations';

export function clampSidebarWidth(w: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w)));
}

/** 'true'/'false' 之外的值(空、拼写、类型)一律回默认 true */
const parseVisible = (raw: string | null): boolean => raw !== 'false';

/** 十进制整数且落在钳制区间内才采信,否则回默认 */
const parseWidth = (raw: string | null): number => {
  if (raw === null || !/^\d+$/.test(raw)) return DEFAULT_WIDTH;
  return clampSidebarWidth(Number(raw));
};

const parseMode = (raw: string | null): TagViewMode => (raw === 'flat' ? 'flat' : 'tree');

/** 开关默认开(与 `parseVisible` 同口径);只有显式 'false' 才为假,空/拼写/类型一律回默认开 */
const parseShowRelations = (raw: string | null): boolean => raw !== 'false';

/** 静默写库:失败不提示不影响会话内状态 */
const persist = (key: string, value: string): void => {
  void api.setSetting(key, value).catch(() => {});
};

export interface SidebarStateApi {
  visible: boolean;
  setVisible: (v: boolean) => void;
  width: number;
  /** 落笔前钳制 180-420;拖拽期间用本地态,仅在松手时调它,避免逐帧写库 */
  setWidth: (w: number) => void;
  mode: TagViewMode;
  setMode: (m: TagViewMode) => void;
  /** 实体树里显示引用(默认开);打开后树行末尾追加关系的**值**小字(悬停该值看属性名) */
  showRelations: boolean;
  setShowRelations: (v: boolean) => void;
}

export function useSidebarState(): SidebarStateApi {
  const [visible, setVisibleState] = useState(true);
  const [width, setWidthState] = useState(DEFAULT_WIDTH);
  const [mode, setModeState] = useState<TagViewMode>('tree');
  const [showRelations, setShowRelationsState] = useState(true);

  // 启动读回(非法值已在解析层回退默认);恢复完成前的默认渲染由主窗 visible:false 掩护
  useEffect(() => {
    void (async () => {
      try {
        const [v, w, m, rel] = await Promise.all([
          api.getSetting(KEY_VISIBLE),
          api.getSetting(KEY_WIDTH),
          api.getSetting(KEY_MODE),
          api.getSetting(KEY_SHOW_RELATIONS),
        ]);
        setVisibleState(parseVisible(v));
        setWidthState(parseWidth(w));
        setModeState(parseMode(m));
        setShowRelationsState(parseShowRelations(rel));
      } catch {
        /* 读失败保持默认,不阻断主界面 */
      }
    })();
  }, []);

  const setVisible = useCallback((v: boolean) => {
    setVisibleState(v);
    persist(KEY_VISIBLE, String(v));
  }, []);

  const setWidth = useCallback((w: number) => {
    const clamped = clampSidebarWidth(w);
    setWidthState(clamped);
    persist(KEY_WIDTH, String(clamped));
  }, []);

  const setMode = useCallback((m: TagViewMode) => {
    setModeState(m);
    persist(KEY_MODE, m);
  }, []);

  const setShowRelations = useCallback((v: boolean) => {
    setShowRelationsState(v);
    persist(KEY_SHOW_RELATIONS, String(v));
  }, []);

  return { visible, setVisible, width, setWidth, mode, setMode, showRelations, setShowRelations };
}
