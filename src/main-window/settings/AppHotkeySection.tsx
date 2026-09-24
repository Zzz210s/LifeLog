// 设置页「快捷键」分区:两个**应用内**快捷键(打开笔记 / 执行命令)的录制行。
// 与「输入栏」分区那一行(系统级,由 Rust 注册)作用域不同,所以分开放:
// 这两个只在主窗 keydown 时匹配,不注册系统热键。命中即聚焦唯一输入框并预填前缀(Task 7)。
// 写入一律走 Rust(规范化 + 冲突检查),
// 成功即广播事件让主窗立刻用新键;失败的中文原因由录制行就地显示,旧键保持可用。
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import type { AppHotkeyKind } from '../../shared/hotkey-match';
import { BTN_SECONDARY } from '../shell/button-classes';
import { AppHotkeyRow } from './AppHotkeyRow';
import { appHotkeyRows } from './app-hotkey-model';

type Stored = Record<AppHotkeyKind, string | null>;

export function AppHotkeySection(): ReactNode {
  const [values, setValues] = useState<Stored | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    Promise.all(appHotkeyRows().map((row) => api.getSetting(row.key).then((v) => [row.kind, v] as const)))
      .then((pairs) => {
        setValues(Object.fromEntries(pairs) as Stored);
        setError('');
      })
      .catch((e) => setError('读取快捷键设置失败: ' + String(e)));
  }, []);

  useEffect(reload, [reload]);

  const setValue = useCallback((kind: AppHotkeyKind, value: string) => {
    setValues((prev) => (prev ? { ...prev, [kind]: value } : prev));
  }, []);

  return (
    <section className="rounded-md border border-border bg-raised">
      <div className="border-b border-border px-4 py-2">
        <h2 className="text-title text-text">快捷键</h2>
        <p className="mt-0.5 text-label text-muted">
          应用内快捷键,只在主窗生效;改动立即保存并生效,不需要点保存按钮
        </p>
      </div>
      {error && <p className="px-4 pt-3 text-label text-danger">{error}</p>}
      {values === null ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6">
          <span className="text-label text-muted">加载中...</span>
          {error && (
            <button type="button" onClick={reload} className={BTN_SECONDARY}>
              重试
            </button>
          )}
        </div>
      ) : (
        <div className="px-4">
          {appHotkeyRows().map((row) => (
            <AppHotkeyRow
              key={row.kind}
              kind={row.kind}
              label={row.label}
              hint={row.hint}
              ariaLabel={row.ariaLabel}
              stored={values[row.kind]}
              onSaved={(value) => setValue(row.kind, value)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
