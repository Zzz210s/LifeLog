// 通用分区(2026-10-04 拆分后):只留行为类设置(新手引导)。版本号与数据库文件已挪到「关于」。
import type { ReactNode } from 'react';
import { BTN_SECONDARY } from '../shell/button-classes';
import { SettingsRow } from './controls';
import { SettingsSection } from './SettingsSection';
import { SETTINGS_SECTIONS } from './settings-sections';

const META = SETTINGS_SECTIONS.find((s) => s.id === 'general')!;

export interface GeneralSectionProps {
  /** 重看新手引导(App 负责先回信息流视图再开层);未传时按钮不做事 */
  onReplayTutorial?: () => void;
}

export function GeneralSection({ onReplayTutorial }: GeneralSectionProps): ReactNode {
  return (
    <SettingsSection meta={META}>
      <SettingsRow label="新手引导">
        <button type="button" onClick={onReplayTutorial} className={BTN_SECONDARY}>
          重新观看
        </button>
      </SettingsRow>
      <p className="border-t border-border py-3 text-label text-muted">
        含空格等不合法的旧标签仍原样保留;在编辑该笔记保存时会按新语法重新解析。
      </p>
    </SettingsSection>
  );
}
