// 外观分区:主题三态(跟随系统/亮色/暗色) + 快捷搜索栏行高。两行都即时生效,切换即写库。
// 主题的真源是设置键 theme(见 shared/theme-mode);这里只做三选一的受控单选。
import type { ReactNode } from 'react';
import { THEME_MODES, type ThemeMode } from '../../shared/theme-mode';
import { NumberSlider } from './number-slider';
import { SettingsRow } from './controls';
import { Segmented } from './segmented';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_SECTIONS } from './settings-sections';
import {
  SEARCH_ROW_HEIGHT_DEFAULT,
  SEARCH_ROW_HEIGHT_MAX,
  SEARCH_ROW_HEIGHT_MIN,
  SEARCH_ROW_HEIGHT_STEP,
} from '../../shared/search-row-height';

export interface AppearanceSectionProps {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  /** 快捷搜索栏行高(不传 = 只读默认值:设置页在无 App 注入的夹具里仍能渲染) */
  searchRow?: { height: number; onChange: (n: number) => void; onReset: () => void };
}

const META = SETTINGS_SECTIONS.find((s) => s.id === 'appearance')!;

export function AppearanceSection({ mode, onChange, searchRow }: AppearanceSectionProps): ReactNode {
  const rowHeight = searchRow?.height ?? SEARCH_ROW_HEIGHT_DEFAULT;
  const resetAll = (): void => {
    onChange('system');
    searchRow?.onReset();
  };
  return (
    <SettingsSection meta={META} onReset={resetAll} resetLabel="恢复本分区默认(主题回跟随系统、行高回 36)">
      <SettingsRow label="主题">
        <Segmented
          value={mode}
          label="主题"
          options={THEME_MODES.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) => onChange(v as ThemeMode)}
        />
      </SettingsRow>
      <SettingsRow
        label="快捷搜索栏行高"
        hint="单行高度(CSS px),默认 36 —— 与 Edge 地址栏同一口径;调大同时放大字号"
      >
        {searchRow ? (
          <NumberSlider
            value={rowHeight}
            label="快捷搜索栏行高"
            min={SEARCH_ROW_HEIGHT_MIN}
            max={SEARCH_ROW_HEIGHT_MAX}
            step={SEARCH_ROW_HEIGHT_STEP}
            suffix="px"
            onCommit={searchRow.onChange}
          />
        ) : (
          <span className="text-ui text-muted">{rowHeight}px</span>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
