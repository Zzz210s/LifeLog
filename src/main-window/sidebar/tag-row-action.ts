/**
 * 侧栏行单击的**意图判定**(设计 2026-10-16 §3/§4,计划 T1):纯函数,不碰 DOM、不读设置、
 * 不改条件 —— 输入(当前模式 + 修饰键状态 + 该行是否可选)输出一个 `RowIntent`。
 * 执行在 `use-tag-click`(T4),条件补丁在 `tag-click-patch`。
 *
 * 优先级(P5/§4.4):修饰键 > 模式;**修饰键内部 Ctrl > Alt > Shift**,只出一个动作 ——
 * Ctrl 的 AND 追加最保守(幂等、只加不减),冲突时让误按代价最小的胜出。
 * 容器行(subtreeCount 0)三模式 × 四修饰键状态一律 `expand`(§4.2)。
 */
import type { SidebarClickMode } from './click-mode';

/** 修饰键状态:⌘ 与 Ctrl 归一为同一个 `ctrl`(macOS 上两者同义) */
export interface ClickMods {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/** 'expand' 恒表示"切换子树展开态"(箭头 / 双击 / ArrowLeft-Right / 容器行单击 都用它) */
export type RowIntent = 'toggle' | 'andAdd' | 'only' | 'exclude' | 'select' | 'open' | 'expand';

/** 从鼠标 / 键盘事件读修饰键:metaKey 与 ctrlKey 归一(⌘ = Ctrl) */
export function modsOf(e: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): ClickMods {
  return { ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey };
}

/** 修饰键意图:优先级 Ctrl > Alt > Shift;都没按返回 null(模式才参与决策) */
export function modifierIntent(m: ClickMods): 'andAdd' | 'exclude' | 'only' | null {
  if (m.ctrl) return 'andAdd';
  if (m.alt) return 'exclude';
  if (m.shift) return 'only';
  return null;
}

/**
 * 单击意图:不可选行恒 `expand`;有修饰键按修饰键;否则由模式决定
 * (`filter` = 筛选开关 / `open` = 打开预览卡片 / `select` = 移光标)。
 */
export function rowIntent(mode: SidebarClickMode, m: ClickMods, selectable: boolean): RowIntent {
  if (!selectable) return 'expand';
  const mod = modifierIntent(m);
  if (mod !== null) return mod;
  if (mode === 'open') return 'open';
  return mode === 'select' ? 'select' : 'toggle';
}
