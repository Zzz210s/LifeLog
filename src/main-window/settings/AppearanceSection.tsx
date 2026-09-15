// 外观分区:主题三态(跟随系统/亮色/暗色)。切换即时生效并写库,主窗同时广播给输入栏。
// 主题的真源是设置键 theme(见 shared/theme-mode);这里只做三选一的受控单选。
import type { ReactNode } from 'react';
import { THEME_MODES, type ThemeMode } from '../../shared/theme-mode';
import { SettingsRow } from './controls';

export interface AppearanceSectionProps {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

export function AppearanceSection({ mode, onChange }: AppearanceSectionProps): ReactNode {
  return (
    <section className="rounded-lg border border-border bg-raised">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium text-text">外观</h2>
        <p className="mt-0.5 text-xs text-faint">
          改动立即生效,并同时应用到输入栏;跟随系统时随系统深浅色自动切换
        </p>
      </div>
      <div className="px-4">
        <SettingsRow label="主题" hint="亮色与暗色各自一套配色,选择会保存到设置表">
          <div className="flex items-center gap-3" role="radiogroup" aria-label="主题">
            {THEME_MODES.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-1 text-xs text-muted"
              >
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => onChange(option.value)}
                  className="accent-accent"
                />
                {option.label}
              </label>
            ))}
          </div>
        </SettingsRow>
      </div>
    </section>
  );
}
