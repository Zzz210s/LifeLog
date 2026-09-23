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
import { BTN_SECONDARY, BTN_WARN } from '../shell/button-classes';

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

  /** clearError=false 用于「写失败后的回读」:回读只刷新期望值/真实值,不能把刚设的失败原因清掉 */
  const reload = useCallback((clearError = true) => {
    Promise.all([loadStartupSettings(), loadAutostartActual()])
      .then(([s, a]) => {
        setSettings(s);
        setActual(a);
        if (clearError) setError('');
      })
      .catch((e) => setError('读取启动设置失败: ' + String(e)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

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
        // Rust 侧返回的已是完整中文文案(如「启用开机启动失败: …」),不再叠加前缀;
        // 下面回读时 clearError=false,否则这条原因会在几毫秒后被清掉
        setError(String(e));
      } finally {
        setBusy(false);
        reload(false);
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
          reload(false);
        });
    },
    [reload]
  );

  const [autostartRow, showRow] = startupRows();
  const status: AutostartState | null =
    settings && actual !== null ? resolveAutostartStatus(settings.autostart, actual) : null;

  return (
    <section className="rounded-md border border-border bg-raised">
      <div className="border-b border-border px-4 py-2">
        <h2 className="text-title text-text">启动</h2>
        <p className="mt-0.5 text-label text-muted">开机启动会在系统注册表中登记;改动立即保存</p>
      </div>
      {error && <p className="px-4 pt-3 text-label text-danger">{error}</p>}
      {settings === null ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6">
          <span className="text-label text-muted">加载中...</span>
          {error && (
            <button
              type="button"
              onClick={() => reload()}
              className={BTN_SECONDARY}
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
                    className={BTN_WARN}
                  >
                    修复
                  </button>
                )}
                <span
                  className={
                    'text-label ' + (status === 'needs-repair' ? 'text-warn' : 'text-muted')
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
          <p className="border-t border-border px-4 py-3 text-label text-muted">
            托盘图标左键打开主窗口,右键打开菜单
          </p>
        </>
      )}
    </section>
  );
}
