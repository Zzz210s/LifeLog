// 分区外壳 + 「恢复本分区默认」按钮(设计 D5):每个分区底部一个,页顶另有「全部恢复默认」。
import type { ReactNode } from 'react';
import { BTN_SECONDARY } from '../shell/button-classes';
import type { SectionMeta } from './settings-sections';

export interface SettingsSectionProps {
  meta: SectionMeta;
  children: ReactNode;
  /** 该分区的恢复默认动作;省略则不显示按钮(如只读的「关于」) */
  onReset?: () => void;
  /** 恢复默认按钮的文案,默认「恢复本分区默认」 */
  resetLabel?: string;
}

/** 一个设置分区:标题(必要时带说明)+ 内容 + 底部恢复默认 */
export function SettingsSection({
  meta,
  children,
  onReset,
  resetLabel = '恢复本分区默认',
}: SettingsSectionProps): ReactNode {
  return (
    <section data-section={meta.id} className="rounded-md border border-border bg-raised">
      <div className="border-b border-border px-4 py-2">
        <h2 className="text-title text-text">{meta.label}</h2>
        {meta.note !== undefined && <p className="mt-0.5 text-label text-muted">{meta.note}</p>}
      </div>
      <div className="px-4">{children}</div>
      {onReset && (
        <div className="border-t border-border px-4 py-3">
          <button type="button" onClick={onReset} className={BTN_SECONDARY}>
            {resetLabel}
          </button>
        </div>
      )}
    </section>
  );
}
