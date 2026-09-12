// 启动分区:开机启动(期望值落库 + Rust 实际注册 + 回读校验)与启动时显示方式。
// 期望值(设置键 input_autostart)与系统真实值分开读:两者不一致时显示「需要修复」并给出修复入口,
// 而不是假装设置已生效(注册表可能被外部改动,或注册动作被系统拦下)。
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import {
  loadAutostartActual,
  loadStartupSettings,
  resolveAutostartStatus,
  saveStartupSetting,
  type AutostartActual,
  type AutostartStatus as AutostartState,
  type StartupSettings,
  type StartupShow,
} from '../../shared/startup-settings';
import { SelectInput, SettingsRow, Toggle } from './controls';
import { startupRows } from './settings-model';

const STATUS_TEXT: Record<AutostartState, string> = {
  off: '已关闭',
  on: '已开启',
  'needs-repair': '需要修复',
};

export function StartupSection(): ReactNode {
  const [settings, setSettings] = useState<StartupSettings | null>(null);
  const [actual, setActual] = useState<AutostartActual | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    Promise.all([loadStartupSettings(), loadAutostartActual()])
      .then(([s, a]) => {
        setSettings(s);
        setActual(a);
        setError('');
      })
      .catch((e) => setError('读取启动设置失败: ' + String(e)));
  }, []);

  useEffect(reload, [reload]);

  /** 先落库用户意图,再让 Rust 真正注册并回读校验;失败时回读真实状态,由界面显示「需要修复」。 */
  const applyAutostart = useCallback(
    async (enabled: boolean) => {
      if (busy) return;
      setBusy(true);
      setSettings((prev) => (prev ? { ...prev, autostart: enabled } : prev));
      try {
        await saveStartupSetting('autostart', enabled);
        await api.setAutostart(enabled);
        setError('');
      } catch (e) {
        setError('开机启动设置失败: ' + String(e));
      } finally {
        setBusy(false);
        reload();
      }
    },
    [busy, reload]
  );

  /** 启动显示方式只是设置键,输入栏下次启动时读取(不广播 input-settings-changed) */
  const applyShow = useCallback(
    (value: StartupShow) => {
      setSettings((prev) => (prev ? { ...prev, startupShow: value } : prev));
      void saveStartupSetting('startupShow', value)
        .then(() => setError(''))
        .catch((e) => {
          setError('保存启动显示方式失败: ' + String(e));
          reload();
        });
    },
    [reload]
  );

  const [autostartRow, showRow] = startupRows();
  const status: AutostartState | null =
    settings && actual !== null ? resolveAutostartStatus(settings.autostart, actual) : null;

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-4 py-2.5">
        <h2 className="text-sm font-medium text-gray-900">启动</h2>
        <p className="mt-0.5 text-xs text-gray-500">开机启动会在系统注册表中登记;改动立即保存</p>
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
            <SettingsRow label={autostartRow.label} hint={autostartRow.hint}>
              <div className="flex items-center gap-2">
                {status === 'needs-repair' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void applyAutostart(settings.autostart)}
                    className="rounded border border-amber-400 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                  >
                    修复
                  </button>
                )}
                <span
                  className={
                    'text-xs ' + (status === 'needs-repair' ? 'text-amber-600' : 'text-gray-500')
                  }
                >
                  {status ? STATUS_TEXT[status] : '读取中...'}
                </span>
                <Toggle
                  checked={settings.autostart}
                  label={autostartRow.label}
                  onChange={(v) => void applyAutostart(v)}
                />
              </div>
            </SettingsRow>
            <SettingsRow label={showRow.label} hint={showRow.hint}>
              <SelectInput
                value={settings.startupShow}
                label={showRow.label}
                options={showRow.options ?? []}
                onChange={applyShow}
              />
            </SettingsRow>
          </div>
          <p className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">
            托盘图标左键唤起输入栏,右键打开菜单
          </p>
        </>
      )}
    </section>
  );
}
