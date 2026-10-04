// 「关于」分区(2026-10-04 从「通用」拆出):版本号与数据库文件,均只读。
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { api } from '../../shared/api';
import type { DbInfo } from '../../shared/types';
import { BTN_SECONDARY } from '../shell/button-classes';
import { SettingsRow } from './controls';
import { SettingsSection } from './SettingsSection';
import { appVersion } from './settings-model';
import { SETTINGS_SECTIONS } from './settings-sections';

const META = SETTINGS_SECTIONS.find((s) => s.id === 'about')!;

export function AboutSection(): ReactNode {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [error, setError] = useState('');

  // 读取失败必须把「正在读取...」换成「读取失败」并给出重试入口(旧实现的教训:两态无法区分)
  const load = useCallback(() => {
    setInfo(null);
    setError('');
    let alive = true;
    api
      .getDbInfo()
      .then((i) => {
        if (alive) setInfo(i);
      })
      .catch((e) => {
        if (alive) setError('读取数据库信息失败: ' + String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(load, [load]);

  const reveal = (): void => {
    if (!info) return;
    void revealItemInDir(info.path).catch((e) => setError('打开文件夹失败: ' + String(e)));
  };

  const hint = info ? `共 ${info.notes} 条笔记` : error ? '读取失败' : '正在读取...';

  return (
    <SettingsSection meta={META}>
      {error !== '' && (
        <div className="flex items-center gap-2 pt-3">
          <p className="text-label text-danger">{error}</p>
          <button type="button" onClick={load} className={BTN_SECONDARY}>
            重试
          </button>
        </div>
      )}
      <SettingsRow label="版本号">
        <span className="text-ui text-muted">{appVersion()}</span>
      </SettingsRow>
      <SettingsRow label="数据库文件" hint={hint}>
        <button type="button" onClick={reveal} disabled={!info} className={BTN_SECONDARY}>
          打开所在文件夹
        </button>
      </SettingsRow>
      <p className="border-t border-border py-3 font-mono text-label break-all text-muted select-all">
        {info ? info.path : error ? '读取失败' : '读取中...'}
      </p>
    </SettingsSection>
  );
}
