/**
 * 用户**主动点了**输入栏,这时才允许它取焦点。
 *
 * 背景(用户 2026-10-03):唤起输入栏默认不夺焦点,免得把全屏游戏踢出画面 ——
 * 窗口以 `set_focusable(false)` 显示(见 Rust `windowing/input_focus.rs`),
 * 只有点一下它才打开可聚焦并取焦点,之后照常打字。
 *
 * 不 await:拿焦点是尽力而为,不能拖慢拖动/点击;失败也不提示(下次点还会再试)。
 * 从 InputBar.tsx 拆出以守住 200 行上限。
 */
import { useCallback } from 'react';
import { api } from '../shared/api';

export function useFocusOnClick(): () => void {
  return useCallback((): void => {
    void api.focusInputBar().catch(() => {});
  }, []);
}
