// 设置页「快捷键」分区的**应用内**录制行(快速打开笔记 / 命令面板)。
// 与「输入栏」分区那一行(系统级)作用域不同:这两个不注册系统热键,只在主窗 keydown 时匹配;
// 保存走 Rust 命令 set_app_hotkey(规范化 + 与系统级键/另一个应用内键的冲突检查),
// 成功后模型层广播 lifelog://app-hotkeys-changed,主窗立刻用新键。
import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_APP_HOTKEYS, effectiveAppHotkey } from '../../shared/hotkey-match';
import type { AppHotkeyKind } from '../../shared/hotkey-match';
import { formatAccelerator } from '../../shared/hotkey-display';
import { SettingsRow } from './controls';
import { BTN_SECONDARY } from '../shell/button-classes';
import { RecorderButton, useHotkeyCapture } from './HotkeyRecorderBox';
import { clearAppHotkey, resetAppHotkey, saveAppHotkey } from './app-hotkey-model';

export interface AppHotkeyRowProps {
  kind: AppHotkeyKind;
  label: string;
  hint: string;
  /** 录制按钮的 aria-label(与全局那行不同名,免得 hotkey.edit 的定位选择器歧义) */
  ariaLabel: string;
  /** 库里的原始值(null/空串 = 未自定义,显示与生效都回退默认键) */
  stored: string | null;
  /** 保存成功(录制/清除/恢复默认)后回传新值,分区据此更新本地状态 */
  onSaved: (value: string) => void;
}

export function AppHotkeyRow({
  kind,
  label,
  hint,
  ariaLabel,
  stored,
  onSaved,
}: AppHotkeyRowProps): ReactNode {
  const effective = effectiveAppHotkey(stored, kind);
  const custom = stored !== null && stored.trim() !== '';
  const fallback = DEFAULT_APP_HOTKEYS[kind];

  const submit = useCallback(
    async (raw: string) => {
      // 清除(空串)与恢复默认各有专属动作,其余是录制值;语义都在 app-hotkey-model 里
      const saved =
        raw === ''
          ? await clearAppHotkey(kind)
          : raw === fallback
            ? await resetAppHotkey(kind)
            : await saveAppHotkey(kind, raw);
      onSaved(saved);
    },
    [fallback, kind, onSaved]
  );
  const box = useHotkeyCapture({ display: formatAccelerator(effective), onSubmit: submit });

  return (
    <>
      <SettingsRow
        label={label}
        hint={`${hint};应用内快捷键,默认 ${formatAccelerator(fallback)},点录制后按下组合键,Esc 取消`}
      >
        <div className="flex items-center gap-2">
          <RecorderButton box={box} ariaLabel={ariaLabel} />
          <button
            type="button"
            disabled={box.busy || !custom}
            onClick={() => void box.run('')}
            className={BTN_SECONDARY}
          >
            清除
          </button>
          <button
            type="button"
            disabled={box.busy || effective === fallback}
            onClick={() => void box.run(fallback)}
            className={BTN_SECONDARY}
          >
            恢复默认
          </button>
        </div>
      </SettingsRow>
      {box.error && <p className="pb-3 text-label text-danger">{box.error}</p>}
    </>
  );
}
