// 「外观」段落的读写状态:挂载读一次;改一项乐观生效 -> 写库 -> 广播 -> 输入栏立即重载;
// 写失败回读并提示(界面不能停在库里没有的状态)。与 InputBarSection 的 update 同取舍。
import { useCallback, useEffect, useState } from 'react';
import {
  APPEARANCE_KEYS,
  loadAppearance,
  saveAppearance,
  type InputAppearance,
} from '../../shared/input-appearance';
import {
  applyPreset as presetPatch,
  withAppearanceChange,
  type BuiltinPreset,
} from '../../shared/input-appearance-presets';
import { notifyInputSettingsChanged } from './input-settings-events';
import { resetAppearance } from './input-appearance-model';

export interface AppearanceEditing {
  appearance: InputAppearance | null;
  error: string;
  update<K extends keyof InputAppearance>(key: K, value: InputAppearance[K]): void;
  applyPreset(id: BuiltinPreset): void;
  reset(): Promise<void>;
  reload(): void;
}

const KEYS = Object.keys(APPEARANCE_KEYS) as (keyof InputAppearance)[];

/** 预设施加:7 个字段逐键写,preset 键**最后**写 —— KV 没有事务接口,这样中途失败时库里
 *  不会留下「声称已套用某预设但字段只写了一半」的状态(与既有 resetInputSettings 同取舍)。 */
async function writePreset(next: InputAppearance): Promise<void> {
  for (const key of KEYS) {
    if (key !== 'preset') await saveAppearance(key, next[key]);
  }
  await saveAppearance('preset', next.preset);
}

export function useAppearanceEditing(): AppearanceEditing {
  const [appearance, setAppearance] = useState<InputAppearance | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    loadAppearance()
      .then((a) => {
        setAppearance(a);
        setError('');
      })
      .catch((e) => setError('读取外观设置失败: ' + String(e)));
  }, []);

  useEffect(reload, [reload]);

  const fail = useCallback(
    (e: unknown) => {
      setError('保存失败: ' + String(e));
      reload();
    },
    [reload]
  );

  const update = useCallback(
    <K extends keyof InputAppearance>(key: K, value: InputAppearance[K]) => {
      if (!appearance) return;
      // 手动改一项 -> withAppearanceChange 顺带把 preset 标成 custom,故 changed 通常含 preset 两键
      const next = withAppearanceChange(appearance, key, value);
      setAppearance(next);
      const changed = KEYS.filter((k) => next[k] !== appearance[k]);
      void Promise.all(changed.map((k) => saveAppearance(k, next[k])))
        .then(() => notifyInputSettingsChanged())
        .catch(fail);
    },
    [appearance, fail]
  );

  const applyPreset = useCallback(
    (id: BuiltinPreset) => {
      if (!appearance) return;
      const next = presetPatch(appearance, id);
      setAppearance(next);
      void writePreset(next).then(() => notifyInputSettingsChanged()).catch(fail);
    },
    [appearance, fail]
  );

  const reset = useCallback(async () => {
    await resetAppearance();
    reload();
  }, [reload]);

  return { appearance, error, update, applyPreset, reset, reload };
}
