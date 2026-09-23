// 设置视图:整页替换信息流(信息流仍挂载在另一分支,返回时状态与滚动位置不丢)。
// 主题三态由 App 持有(需要在信息流视图下也持续跟随系统),这里只透传给「外观」分区。
import type { ReactNode } from 'react';
import type { ThemeMode } from '../../shared/theme-mode';
import { AppearanceSection } from './AppearanceSection';
import { AppHotkeySection } from './AppHotkeySection';
import { GeneralSection } from './GeneralSection';
import { InputBarSection } from './InputBarSection';
import { NotesSection } from './NotesSection';
import { StartupSection } from './StartupSection';

export interface SettingsViewProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
}

export function SettingsView({ themeMode, onThemeChange }: SettingsViewProps): ReactNode {
  return (
    <div className="scroll-gutter flex-1 overflow-y-auto bg-panel">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
        <h1 className="text-display text-text">设置</h1>
        <AppearanceSection mode={themeMode} onChange={onThemeChange} />
        <InputBarSection />
        <AppHotkeySection />
        <NotesSection />
        <StartupSection />
        <GeneralSection />
      </div>
    </div>
  );
}
