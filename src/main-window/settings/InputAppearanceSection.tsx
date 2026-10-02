// 「输入栏」分区里的「外观」段落:预设、亮暗页签、底色/边框色色盘、圆角/阴影/透明度。
// 只负责摆放与页签状态;读写与落库在 useAppearanceEditing,键名不在此出现裸字符串。
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  BG_OPACITY_MAX,
  BG_OPACITY_MIN,
  RADIUS_MAX,
  RADIUS_MIN,
  type BorderColor,
  type InputAppearance,
  type SurfaceColor,
} from '../../shared/input-appearance';
import type { BuiltinPreset } from '../../shared/input-appearance-presets';
import { useIsDark } from '../../shared/use-is-dark';
import { BTN_SECONDARY } from '../shell/button-classes';
import { SettingsRow } from './controls';
import { appearanceRows, bgHint, opacityWarning } from './input-appearance-model';
import { BTN_CHOICE, choiceState, ColorSwatch, PresetButtons, RangeSlider, ShadowButtons } from './appearance-controls';

export interface InputAppearanceSectionProps {
  appearance: InputAppearance | null;
  error: string;
  onUpdate: <K extends keyof InputAppearance>(key: K, value: InputAppearance[K]) => void;
  onApplyPreset: (id: BuiltinPreset) => void;
  onReload: () => void;
}

export function InputAppearanceSection({ appearance, error, onUpdate, onApplyPreset, onReload }: InputAppearanceSectionProps): ReactNode {
  // 页签只决定「正在编辑哪一份颜色」,默认跟随当前主题(不改变主题本身)
  const [tab, setTab] = useState<'light' | 'dark'>(useIsDark() ? 'dark' : 'light');

  if (appearance === null) {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <span className="text-label text-muted">加载中...</span>
        {error !== '' && (
          <button type="button" onClick={onReload} className={BTN_SECONDARY}>
            重试
          </button>
        )}
      </div>
    );
  }

  // 早返回后收窄成非空局部量:嵌套函数里 TS 不再跟踪 appearance 的窄化
  const a = appearance;
  const darkTab = tab === 'dark';
  const bgKey = darkTab ? 'bgDark' : 'bg';
  const borderKey = darkTab ? 'borderDark' : 'border';
  const warn = opacityWarning(a.opacity);

  function control(key: 'radius' | 'shadow' | 'opacity'): ReactNode {
    if (key === 'shadow') return <ShadowButtons value={a.shadow} onPick={(v) => onUpdate('shadow', v)} />;
    if (key === 'opacity') {
      return (
        <RangeSlider value={a.opacity} min={BG_OPACITY_MIN} max={BG_OPACITY_MAX} step={5} label="透明度" suffix="%" onCommit={(n) => onUpdate('opacity', n)} />
      );
    }
    return <RangeSlider value={a.radius} min={RADIUS_MIN} max={RADIUS_MAX} step={1} label="圆角" suffix="px" onCommit={(n) => onUpdate('radius', n)} />;
  }

  return (
    <div>
      <h3 className="pt-3 text-ui text-text">外观</h3>
      <SettingsRow label="预设形态" hint="一键套用一组外观,套用后仍可逐项微调">
        <PresetButtons value={a.preset} onPick={onApplyPreset} />
      </SettingsRow>
      <SettingsRow label="色值页签" hint="亮色与暗色各存一份底色与边框色">
        <div className="flex gap-1">
          <button type="button" aria-pressed={!darkTab} onClick={() => setTab('light')} className={BTN_CHOICE + choiceState(!darkTab)}>
            亮色
          </button>
          <button type="button" aria-pressed={darkTab} onClick={() => setTab('dark')} className={BTN_CHOICE + choiceState(darkTab)}>
            暗色
          </button>
        </div>
      </SettingsRow>
      <SettingsRow label="底色" hint={bgHint(a[bgKey])}>
        <ColorSwatch value={a[bgKey]} label="底色" allowTransparent onChange={(v) => onUpdate(bgKey, v as SurfaceColor)} />
      </SettingsRow>
      <SettingsRow label="边框色" hint="可设透明或与底色同色,也可单取自主题">
        <ColorSwatch value={a[borderKey]} label="边框色" allowTransparent={false} onChange={(v) => onUpdate(borderKey, v as BorderColor)} />
      </SettingsRow>
      {appearanceRows().map((row) => (
        <SettingsRow key={row.key} label={row.label} hint={row.key === 'opacity' && warn ? row.hint + ';' + warn : row.hint}>
          {control(row.key)}
        </SettingsRow>
      ))}
    </div>
  );
}
