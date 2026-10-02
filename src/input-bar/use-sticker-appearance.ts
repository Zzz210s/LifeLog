// 输入栏读取外观设置 -> 合成 CSS 变量(挂在根 div 的内联 style 上)。
// 挂载读一次;窗口获得焦点重读;主窗设置页写库后广播 input-settings-changed,收到即重读。
// 读失败静默保持默认:不打断输入,视觉上回退主题令牌(与 spec §4 的「未设置时回退」同效)。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { INPUT_SETTINGS_CHANGED_EVENT } from '../shared/input-settings';
import { APPEARANCE_DEFAULTS, loadAppearance, type InputAppearance } from '../shared/input-appearance';
import { stickerStyleVars, type StickerStyle } from '../shared/sticker-style';
import { useIsDark } from '../shared/use-is-dark';

export function useStickerAppearance(): { appearance: InputAppearance; vars: StickerStyle } {
  const [appearance, setAppearance] = useState<InputAppearance>(APPEARANCE_DEFAULTS);
  const dark = useIsDark();

  const reload = useCallback(async () => {
    try {
      setAppearance(await loadAppearance());
    } catch {
      // 静默:回退默认值(= 主题令牌),下一次焦点/广播会再试;这里弹错只会打扰输入
    }
  }, []);

  useEffect(() => {
    void reload();
    const win = getCurrentWindow();
    let alive = true;
    const offs: (() => void)[] = [];
    const keep = (un: () => void) => {
      if (alive) offs.push(un);
      else un();
    };
    // 与 use-input-settings 同口径:只处理「获得焦点」(失焦重读会把未落库的改动弹回)
    void win
      .onFocusChanged(({ payload: focused }) => {
        if (alive && focused) void reload();
      })
      .then(keep)
      .catch(() => {});
    void listen(INPUT_SETTINGS_CHANGED_EVENT, () => {
      void reload();
    })
      .then(keep)
      .catch(() => {});
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [reload]);

  const vars = useMemo(() => stickerStyleVars(appearance, dark), [appearance, dark]);
  return { appearance, vars };
}
