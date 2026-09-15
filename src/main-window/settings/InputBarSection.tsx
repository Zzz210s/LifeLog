// 输入栏分区:9 项设置读取自 settings 表,改动即落库(无保存按钮),底部可整批恢复默认。
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  loadInputSettings,
  saveInputSetting,
  type InputSettings,
} from '../../shared/input-settings';
import { RowControl, SettingsRow } from './controls';
import { notifyInputSettingsChanged } from './input-settings-events';
import { inputResetKeys, inputRows, resetInputSettings, withInputSetting } from './settings-model';

export function InputBarSection(): ReactNode {
  const [settings, setSettings] = useState<InputSettings | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    loadInputSettings()
      .then((s) => {
        setSettings(s);
        setError('');
      })
      .catch((e) => setError('读取输入栏设置失败: ' + String(e)));
  }, []);

  useEffect(reload, [reload]);

  /** 乐观更新:先动界面再写库;写失败时提示并回读,避免界面与库反向偏离。
   * 写成功后广播 input-settings-changed:输入栏常驻可见时也立即重载(见 input-settings-events)。 */
  const update = useCallback(
    (key: keyof InputSettings, value: InputSettings[keyof InputSettings]) => {
      setSettings((prev) => (prev ? withInputSetting(prev, key, value) : prev));
      void saveInputSetting(key, value)
        .then(() => notifyInputSettingsChanged())
        .catch((e) => {
          setError('保存失败: ' + String(e));
          reload();
        });
    },
    [reload]
  );

  const onReset = useCallback(async () => {
    const count = inputResetKeys().length;
    // 二次确认必须用插件导出的 async confirm(走 plugin:dialog|message,在 dialog:default 权限内)。
    // 不能用 window.confirm:tauri-plugin-dialog 的初始化脚本把它改成了 async(返回 Promise),
    // 布尔上下文恒为真;且它走的 plugin:dialog|confirm 不在默认权限里会直接 reject
    // ——既不等回答也不弹窗,确认形同虚设(2026-09-12 实测,见 task-5 报告)。
    const ok = await confirm(`恢复输入栏分区的 ${count} 项设置为默认值?`, {
      title: '恢复输入栏分区默认',
      kind: 'warning',
    }).catch(() => false); // 弹窗失败一律当作取消,不意外清空用户设置
    if (!ok) return;
    void resetInputSettings()
      .then(() => notifyInputSettingsChanged())
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
    <section className="rounded-lg border border-border bg-raised">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium text-text">输入栏</h2>
        <p className="mt-0.5 text-xs text-faint">改动立即生效并保存,不需要点保存按钮</p>
      </div>
      {error && <p className="px-4 pt-3 text-xs text-danger">{error}</p>}
      {settings === null ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6">
          <span className="text-xs text-faint">加载中...</span>
          {error && (
            <button
              type="button"
              onClick={reload}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted hover:bg-hover"
            >
              重试
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="px-4">
            {inputRows().map((row) => (
              <SettingsRow key={row.key} label={row.label} hint={row.hint}>
                <RowControl row={row} value={settings[row.key]} onChange={update} />
              </SettingsRow>
            ))}
          </div>
          <div className="border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={onReset}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent-text"
            >
              恢复输入栏分区默认
            </button>
          </div>
        </>
      )}
    </section>
  );
}
