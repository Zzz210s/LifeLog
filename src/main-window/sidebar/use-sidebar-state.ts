/**
 * 侧栏状态与持久化(spec 6.1):整栏显隐、宽度(180-420 钳制)、标签树/扁平模式、
 * 标签树里是否显示携带(标签角色 spec §5,默认关)。
 * 四个设置键 sidebar_visible / sidebar_width / tag_view_mode / tag_tree_show_carry;读取失败或非法值一律回默认。
 * 写入失败静默(不影响本次会话);宽度写入前钳制,拖拽中的高频变更由调用方攒批。
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
const KEY_SHOW_CARRY = 'tag_tree_show_carry';

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

/** 开关默认关;只有显式 'true' 才为真(空、拼写、类型一律回默认) */
const parseShowCarry = (raw: string | null): boolean => raw === 'true';

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
  /** 标签树里显示携带(默认关);打开后树行末尾追加 `国籍 → 日本` 小字 */
  showCarry: boolean;
  setShowCarry: (v: boolean) => void;
}

export function useSidebarState(): SidebarStateApi {
  const [visible, setVisibleState] = useState(true);
  const [width, setWidthState] = useState(DEFAULT_WIDTH);
  const [mode, setModeState] = useState<TagViewMode>('tree');
  const [showCarry, setShowCarryState] = useState(false);

  // 启动读回(非法值已在解析层回退默认);恢复完成前的默认渲染由主窗 visible:false 掩护
  useEffect(() => {
    void (async () => {
      try {
        const [v, w, m, c] = await Promise.all([
          api.getSetting(KEY_VISIBLE),
          api.getSetting(KEY_WIDTH),
          api.getSetting(KEY_MODE),
          api.getSetting(KEY_SHOW_CARRY),
        ]);
        setVisibleState(parseVisible(v));
        setWidthState(parseWidth(w));
        setModeState(parseMode(m));
        setShowCarryState(parseShowCarry(c));
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

  const setShowCarry = useCallback((v: boolean) => {
    setShowCarryState(v);
    persist(KEY_SHOW_CARRY, String(v));
  }, []);

  return { visible, setVisible, width, setWidth, mode, setMode, showCarry, setShowCarry };
}
