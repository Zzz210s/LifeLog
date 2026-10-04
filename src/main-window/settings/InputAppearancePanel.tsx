// 「输入栏外观」分区(2026-10-04 从「输入栏」拆出):预设、色值页签、底色/边框色、圆角、阴影、透明度。
import type { ReactNode } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { appearanceResetKeys } from './input-appearance-model';
import { InputAppearanceSection } from './InputAppearanceSection';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_SECTIONS } from './settings-sections';
import { notifyInputSettingsChanged } from './input-settings-events';
import { useAppearanceEditing } from './use-appearance-editing';

const META = SETTINGS_SECTIONS.find((s) => s.id === 'inputAppearance')!;

export function InputAppearancePanel(): ReactNode {
  const editing = useAppearanceEditing();
  const onReset = async (): Promise<void> => {
    const count = appearanceResetKeys().length;
    // 二次确认走插件 async confirm(见 InputBarSection 的说明:window.confirm 在 tauri 下恒为真)
    const ok = await confirm(`恢复输入栏外观的 ${count} 项设置为默认值?`, {
      title: '恢复输入栏外观默认',
      kind: 'warning',
    }).catch(() => false);
    if (!ok) return;
    await editing.reset();
    notifyInputSettingsChanged();
  };

  return (
    <SettingsSection meta={META} onReset={() => void onReset()}>
      <InputAppearanceSection
        appearance={editing.appearance}
        error={editing.error}
        onUpdate={editing.update}
        onApplyPreset={editing.applyPreset}
        onReload={editing.reload}
      />
    </SettingsSection>
  );
}
