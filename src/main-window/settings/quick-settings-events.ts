// 主窗 -> 快捷窗的设置变更通知:设置页写库成功后广播,快捷窗收到即重载(见 use-quick-settings),
// 使「窗口置顶」等改动在快捷窗常驻可见时也立即生效,不必等下一次唤起。
// 事件只是「加速通道」:即便丢失(或快捷窗没起来),快捷窗下次获得焦点仍会重载,故发送失败静默。
import { emit } from '@tauri-apps/api/event';
import { QUICK_SETTINGS_CHANGED_EVENT } from '../../shared/quick-settings';

export function notifyQuickSettingsChanged(): Promise<void> {
  return emit(QUICK_SETTINGS_CHANGED_EVENT).catch(() => {});
}
