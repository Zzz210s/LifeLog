// 通用分区:应用版本号与数据库文件路径(均只读),并提供"打开所在文件夹"与读取失败重试。
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { api } from '../../shared/api';
import type { DbInfo } from '../../shared/types';
import { SettingsRow } from './controls';
import { appVersion } from './settings-model';
import { BTN_SECONDARY } from '../shell/button-classes';

export interface GeneralSectionProps {
  /** 重看新手引导(App 负责先回信息流视图再开层);未传时按钮不做事 */
  onReplayTutorial?: () => void;
}

export function GeneralSection({ onReplayTutorial }: GeneralSectionProps): ReactNode {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [error, setError] = useState('');

  // 读取失败时必须把「正在读取...」换成「读取失败」并给出重试入口:
  // 否则失败态与进行中态在界面上无法区分,用户只能等(旧实现就是永远停在读取中)。
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

  const reveal = () => {
    if (!info) return;
    void revealItemInDir(info.path).catch((e) => setError('打开文件夹失败: ' + String(e)));
  };

  const hint = info ? `共 ${info.notes} 条笔记` : error ? '读取失败' : '正在读取...';

  return (
    <section className="rounded-md border border-border bg-raised">
      <div className="border-b border-border px-4 py-2">
        <h2 className="text-title text-text">通用</h2>
        <p className="mt-0.5 text-label text-muted">应用与数据文件信息,均只读</p>
      </div>
      {error && (
        <div className="flex items-center gap-2 px-4 pt-3">
          <p className="text-label text-danger">{error}</p>
          <button
            type="button"
            onClick={load}
            className={BTN_SECONDARY}
          >
            重试
          </button>
        </div>
      )}
      <div className="px-4">
        <SettingsRow label="新手引导" hint="随时重看第一步的操作说明">
          <button type="button" onClick={onReplayTutorial} className={BTN_SECONDARY}>
            重新观看
          </button>
        </SettingsRow>
        <SettingsRow label="版本号" hint="当前应用版本,构建时写入">
          <span className="text-ui text-muted">{appVersion()}</span>
        </SettingsRow>
        <SettingsRow label="数据库文件" hint={hint}>
          <button
            type="button"
            onClick={reveal}
            disabled={!info}
            className={BTN_SECONDARY}
          >
            打开所在文件夹
          </button>
        </SettingsRow>
      </div>
      <p className="border-t border-border px-4 py-2 text-label text-muted">
        含空格等不合法的旧标签仍原样保留;在编辑该笔记保存时会按新语法重新解析。
      </p>
      <p className="border-t border-border px-4 py-3 font-mono text-label break-all text-muted select-all">
        {info ? info.path : error ? '读取失败' : '读取中...'}
      </p>
    </section>
  );
}
