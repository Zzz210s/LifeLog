// 输入栏设置的读写(从 InputBarSection 抽出,2026-10-04 拆分分区时共用一份状态)。
// 乐观更新:先动界面再写库;写失败提示并回读,避免界面与库反向偏离。
import { useCallback, useEffect, useState } from 'react';
import {
  loadInputSettings,
  saveInputSetting,
  type InputSettings,
} from '../../shared/input-settings';
import { notifyInputSettingsChanged } from './input-settings-events';
import { resetInputSettings, withInputSetting } from './settings-model';
import { useAppearanceEditing } from './use-appearance-editing';

export interface InputSettingsState {
  settings: InputSettings | null;
  error: string;
  reload: () => void;
  update: (key: keyof InputSettings, value: InputSettings[keyof InputSettings]) => void;
  /** 只重置行为 10 项(外观那份由 editing.reset 负责) */
  resetBehavior: () => Promise<void>;
  editing: ReturnType<typeof useAppearanceEditing>;
}

export function useInputSettings(): InputSettingsState {
  const [settings, setSettings] = useState<InputSettings | null>(null);
  const [error, setError] = useState('');
  const editing = useAppearanceEditing();

  const reload = useCallback(() => {
    loadInputSettings()
      .then((s) => {
        setSettings(s);
        setError('');
      })
      .catch((e) => setError('读取输入栏设置失败: ' + String(e)));
  }, []);

  useEffect(reload, [reload]);

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

  const resetBehavior = useCallback(
    () =>
      resetInputSettings()
        .then(() => notifyInputSettingsChanged())
        .then(() => {
          setError('');
          reload();
        })
        .catch((e) => {
          setError('恢复默认失败: ' + String(e));
          reload();
        }),
    [reload]
  );

  return { settings, error, reload, update, resetBehavior, editing };
}
