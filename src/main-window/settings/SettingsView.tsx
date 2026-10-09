// 设置视图(2026-10-04 重构):左导航 + 右内容,一次只显示一个分区(设计 D1/D7)。
// 分区注册表在 settings-sections.ts;每个分区自带「恢复本分区默认」,页顶另有「全部恢复默认」。
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { ThemeMode } from '../../shared/theme-mode';
import { BTN_SECONDARY } from '../shell/button-classes';
import { AboutSection } from './AboutSection';
import { AppHotkeySection } from './AppHotkeySection';
import { AppearanceSection } from './AppearanceSection';
import { GeneralSection } from './GeneralSection';
import { InputAppearancePanel } from './InputAppearancePanel';
import { InputBehaviorPanel } from './InputBehaviorPanel';
import { NotesSection } from './NotesSection';
import { RelationSuggestionsSection } from './RelationSuggestionsSection';
import { SettingsNav } from './settings-nav';
import { normalizeSection, type SectionId } from './settings-sections';
import { StartupSection } from './StartupSection';
import { appearanceResetKeys } from './input-appearance-model';
import { inputResetKeys, resetInputSettings } from './settings-model';
import { useAppearanceEditing } from './use-appearance-editing';
import { notifyInputSettingsChanged } from './input-settings-events';

export interface SettingsViewProps {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  /** 重看新手引导(设计 D6);未传则该行按钮不做事 */
  onReplayTutorial?: () => void;
  /** Esc 返回信息流(与关系图 Esc 同一只手感;顶栏导航组的「信息流」是鼠标入口) */
  onBack?: () => void;
  /** 「标签关系」分区里的「实体树里显示引用」当前值(与侧栏同一份状态,透传) */
  showRelations?: boolean;
  onShowRelationsChange?: (v: boolean) => void;
}

export function SettingsView({ themeMode, onThemeChange, onReplayTutorial, onBack, showRelations, onShowRelationsChange }: SettingsViewProps): ReactNode {
  const [active, setActive] = useState<SectionId>(() => normalizeSection('appearance'));
  const editing = useAppearanceEditing();

  // Esc 退出设置(2026-10-07):与关系图一致。嵌套浮层(色盘 / 热键录制)自己先吃掉 Esc
  // (`useDismiss` 在捕获阶段 stopPropagation;色盘同),所以只有宿页麋下的 Esc 才回来。
  // 原生 select 展开时 Esc 先关下拉再冒泡:此时不退出,避免误触。
  useEffect(() => {
    if (!onBack) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  /** 全部恢复默认:主题回「跟随系统」,输入栏行为与外观各回默认(逐项由各自模块负责) */
  const resetAll = useCallback(async () => {
    const count = inputResetKeys().length + appearanceResetKeys().length + 1;
    const ok = await confirm(`恢复全部 ${count} 项设置为默认值?`, {
      title: '恢复全部默认',
      kind: 'warning',
    }).catch(() => false);
    if (!ok) return;
    onThemeChange('system');
    await Promise.all([resetInputSettings(), editing.reset()]);
    notifyInputSettingsChanged();
  }, [editing, onThemeChange]);

  const body = (): ReactNode => {
    switch (active) {
      case 'appearance':
        return <AppearanceSection mode={themeMode} onChange={onThemeChange} />;
      case 'inputAppearance':
        return <InputAppearancePanel />;
      case 'inputBehavior':
        return <InputBehaviorPanel />;
      case 'notes':
        return <NotesSection />;
      case 'relations':
        return <RelationSuggestionsSection showRelations={showRelations} onShowRelationsChange={onShowRelationsChange} />;
      case 'hotkey':
        return <AppHotkeySection />;
      case 'startup':
        return <StartupSection />;
      case 'general':
        return <GeneralSection onReplayTutorial={onReplayTutorial} />;
      case 'about':
        return <AboutSection />;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 bg-panel">
      <SettingsNav active={active} onPick={setActive} />
      <div className="scroll-gutter flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-display text-text">设置</h1>
            <button type="button" onClick={() => void resetAll()} className={BTN_SECONDARY}>
              全部恢复默认
            </button>
          </div>
          {body()}
        </div>
      </div>
    </div>
  );
}
