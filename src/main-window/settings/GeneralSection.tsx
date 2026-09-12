// 通用分区:应用版本号与数据库文件路径(均只读),并提供"打开所在文件夹"。
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { api } from '../../shared/api';
import type { DbInfo } from '../../shared/types';
import { SettingsRow } from './controls';
import { appVersion } from './settings-model';

export function GeneralSection(): ReactNode {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api
      .getDbInfo()
      .then((i) => {
        if (alive) {
          setInfo(i);
          setError('');
        }
      })
      .catch((e) => {
        if (alive) setError('读取数据库信息失败: ' + String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const reveal = () => {
    if (!info) return;
    void revealItemInDir(info.path).catch((e) => setError('打开文件夹失败: ' + String(e)));
  };

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-2.5">
        <h2 className="text-sm font-medium text-gray-900">通用</h2>
        <p className="mt-0.5 text-xs text-gray-500">应用与数据文件信息,均只读</p>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-red-500">{error}</p>}
      <div className="px-4">
        <SettingsRow label="版本号" hint="当前应用版本,构建时写入">
          <span className="text-sm text-gray-700">{appVersion()}</span>
        </SettingsRow>
        <SettingsRow label="数据库文件" hint={info ? `共 ${info.notes} 条笔记` : '正在读取...'}>
          <button
            type="button"
            onClick={reveal}
            disabled={!info}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            打开所在文件夹
          </button>
        </SettingsRow>
      </div>
      <p className="border-t border-gray-100 px-4 py-3 font-mono text-xs break-all text-gray-500 select-all">
        {info ? info.path : '读取中...'}
      </p>
    </section>
  );
}
