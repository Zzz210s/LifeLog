// 外观分区:主题三态(跟随系统/亮色/暗色)。切换即时生效并写库,主窗同时广播给输入栏。
// 主题的真源是设置键 theme(见 shared/theme-mode);这里只做三选一的受控单选。
import type { ReactNode } from 'react';
import { THEME_MODES, type ThemeMode } from '../../shared/theme-mode';
import { SettingsRow } from './controls';
import { Segmented } from './segmented';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_SECTIONS } from './settings-sections';

export interface AppearanceSectionProps {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

const META = SETTINGS_SECTIONS.find((s) => s.id === 'appearance')!;

export function AppearanceSection({ mode, onChange }: AppearanceSectionProps): ReactNode {
  return (
    <SettingsSection meta={META} onReset={() => onChange('system')} resetLabel="恢复本分区默认(主题回跟随系统)">
      <SettingsRow label="主题">
        <Segmented
          value={mode}
          label="主题"
          options={THEME_MODES.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) => onChange(v as ThemeMode)}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
