// 快捷输入分区:9 项设置读取自 settings 表,改动即落库(无保存按钮),底部可整批恢复默认。
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  loadQuickSettings,
  saveQuickSetting,
  type QuickSettings,
} from '../../shared/quick-settings';
import { RowControl, SettingsRow } from './controls';
import { quickResetKeys, quickRows, resetQuickSettings, withQuickSetting } from './settings-model';

export function QuickWindowSection(): ReactNode {
  const [settings, setSettings] = useState<QuickSettings | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    loadQuickSettings()
      .then((s) => {
        setSettings(s);
        setError('');
      })
      .catch((e) => setError('读取快捷窗设置失败: ' + String(e)));
  }, []);

  useEffect(reload, [reload]);

  /** 乐观更新:先动界面再写库;写失败时提示并回读,避免界面与库反向偏离 */
  const update = useCallback(
    (key: keyof QuickSettings, value: QuickSettings[keyof QuickSettings]) => {
      setSettings((prev) => (prev ? withQuickSetting(prev, key, value) : prev));
      void saveQuickSetting(key, value).catch((e) => {
        setError('保存失败: ' + String(e));
        reload();
      });
    },
    [reload]
  );

  const onReset = useCallback(() => {
    const count = quickResetKeys().length;
    if (!window.confirm(`恢复快捷输入分区的 ${count} 项设置为默认值?`)) return;
    void resetQuickSettings()
      .then(() => {
        setError('');
        reload();
      })
      .catch((e) => {
        setError('恢复默认失败: ' + String(e));
        reload();
      });
  }, [reload]);

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-2.5">
        <h2 className="text-sm font-medium text-gray-900">快捷输入</h2>
        <p className="mt-0.5 text-xs text-gray-500">改动立即生效并保存,不需要点保存按钮</p>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-red-500">{error}</p>}
      {settings === null ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6">
          <span className="text-xs text-gray-400">加载中...</span>
          {error && (
            <button
              type="button"
              onClick={reload}
              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              重试
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="px-4">
            {quickRows().map((row) => (
              <SettingsRow key={row.key} label={row.label} hint={row.hint}>
                <RowControl row={row} value={settings[row.key]} onChange={update} />
              </SettingsRow>
            ))}
          </div>
          <div className="border-t border-gray-200 px-4 py-3">
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:border-blue-500 hover:text-blue-600"
            >
              恢复快捷输入分区默认
            </button>
          </div>
        </>
      )}
    </section>
  );
}
