// 「输入栏行为」分区(2026-10-04 从「输入栏」拆出):10 项行为设置 + 输入栏热键。
import type { ReactNode } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { RowControl, SettingsRow } from './controls';
import { HotkeyRecorder } from './HotkeyRecorder';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_SECTIONS } from './settings-sections';
import { inputResetKeys, inputRows } from './settings-model';
import { useInputSettings } from './use-input-settings';

const META = SETTINGS_SECTIONS.find((s) => s.id === 'inputBehavior')!;

export function InputBehaviorPanel(): ReactNode {
  const { settings, error, reload, update, resetBehavior } = useInputSettings();

  const onReset = async (): Promise<void> => {
    const count = inputResetKeys().length;
    const ok = await confirm(`恢复输入栏行为的 ${count} 项设置为默认值?`, {
      title: '恢复输入栏行为默认',
      kind: 'warning',
    }).catch(() => false);
    if (!ok) return;
    await resetBehavior();
  };

  return (
    <SettingsSection meta={META} onReset={() => void onReset()}>
      {error !== '' && <p className="pt-3 text-label text-danger">{error}</p>}
      {settings === null ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <span className="text-label text-muted">加载中...</span>
          {error !== '' && (
            <button type="button" onClick={reload} className="h-8 rounded-sm border border-border-strong px-2 text-ui text-muted">
              重试
            </button>
          )}
        </div>
      ) : (
        <>
          {inputRows().map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.hint}>
              <RowControl row={row} value={settings[row.key]} onChange={update} />
            </SettingsRow>
          ))}
          <HotkeyRecorder />
        </>
      )}
    </SettingsSection>
  );
}
