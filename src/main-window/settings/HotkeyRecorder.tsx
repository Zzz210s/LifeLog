// 输入栏分区的**系统级**快捷键(唤起/隐藏输入栏)录制行:提交给 Rust 的 set_input_hotkey
// (先注册成功再落库),失败(非法/被占用/保存失败)保留捕获态并显示原因。
// 落库失败时新键已生效、旧键已注销 —— 显示必须跟着**生效值**走,否则按钮显示的是个死键。
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api';
import {
  DEFAULT_HOTKEY,
  HOTKEY_KEY,
  effectiveAccelerator,
  formatAccelerator,
} from '../../shared/hotkey-display';
import { SettingsRow } from './controls';
import { BTN_SECONDARY } from '../shell/button-classes';
import { RecorderButton, useHotkeyCapture } from './HotkeyRecorderBox';

const LABEL = '唤起/隐藏快捷键';

export function HotkeyRecorder(): ReactNode {
  const [accelerator, setAccelerator] = useState<string | null>(null); // null = 读取中
  const [loadError, setLoadError] = useState('');

  // 显示运行时**生效值**(与真实注册状态一致),取不到才回退库值
  useEffect(() => {
    void (async () => {
      try {
        const [live, raw] = await Promise.all([api.getInputHotkey(), api.getSetting(HOTKEY_KEY)]);
        setAccelerator(live ?? effectiveAccelerator(raw));
      } catch (e) {
        setLoadError('读取快捷键设置失败: ' + String(e));
        setAccelerator(DEFAULT_HOTKEY);
      }
    })();
  }, []);

  /** 提交给 Rust:成功返回;失败时新键可能已生效,回读生效值再抛原因 */
  const submit = useCallback(async (raw: string) => {
    try {
      setAccelerator(await api.setInputHotkey(raw));
    } catch (e) {
      void api
        .getInputHotkey()
        .then((live) => {
          if (live) setAccelerator(live);
        })
        .catch(() => {});
      throw e;
    }
  }, []);

  const box = useHotkeyCapture({ display: formatAccelerator(accelerator ?? ''), onSubmit: submit });

  return (
    <>
      <SettingsRow
        label={LABEL}
        hint="系统级快捷键:输入栏显示中则隐藏,隐藏中则恢复显示;点录制后按下组合键,Esc 取消"
      >
        <div className="flex items-center gap-2">
          <RecorderButton box={box} />
          <button
            type="button"
            disabled={box.busy || accelerator === DEFAULT_HOTKEY}
            onClick={() => void box.run(DEFAULT_HOTKEY)}
            className={BTN_SECONDARY}
          >
            恢复默认
          </button>
        </div>
      </SettingsRow>
      {(loadError || box.error) && (
        <p className="pb-3 text-label text-danger">{loadError || box.error}</p>
      )}
    </>
  );
}
