/**
 * 设置页「单击实体行的行为」一行(设计 2026-10-16 §6):值、写库都与侧栏头部那颗模式按钮
 * 同一份状态(键 `sidebar_click_mode`),两条入口互不替代。控件复用 `Segmented`(两档 +
 * 左右方向键可达,`aria-pressed` 由组件给出)。本组件纯 props,不读设置、不碰 IPC。
 * 2026-10-16 按用户要求由三档减为两档(筛选/打开)。
 * 2026-10-17 用户要求:打开档单击 = 只看这一条(不再是预览),hint 同步改口径。
 */
import type { ReactNode } from 'react';
import { CLICK_MODE_LABELS, CLICK_MODE_ORDER, type SidebarClickMode } from '../sidebar/click-mode';
import { SettingsRow } from './controls';
import { Segmented } from './segmented';

export interface SidebarClickModeRowProps {
  value: SidebarClickMode;
  onChange: (m: SidebarClickMode) => void;
}

export function SidebarClickModeRow({ value, onChange }: SidebarClickModeRowProps): ReactNode {
  return (
    <SettingsRow
      label="单击实体行的行为"
      hint="侧栏里单击一行做什么。筛选档 = 加入 / 移出筛选；打开档 = 只看这一条（主页只剩该实体）。双击在打开档 = 预览卡片、其余 = 展开子树；Ctrl/⌘ 追加为同时满足、Alt 排除、Shift 只看这条。"
    >
      <Segmented
        value={value}
        label="单击实体行的行为"
        options={CLICK_MODE_ORDER.map((m) => ({ value: m, label: CLICK_MODE_LABELS[m] }))}
        onChange={onChange}
      />
    </SettingsRow>
  );
}
