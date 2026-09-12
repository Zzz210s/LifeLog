// 主窗 -> 输入栏的设置变更通知:设置页写库成功后广播,输入栏收到即重载(见 use-input-settings),
// 使「窗口置顶」等改动在输入栏常驻可见时也立即生效,不必等下一次唤起。
// 事件只是「加速通道」:即便丢失(或输入栏没起来),输入栏下次获得焦点仍会重载,故发送失败静默。
import { emit } from '@tauri-apps/api/event';
import { INPUT_SETTINGS_CHANGED_EVENT } from '../../shared/input-settings';

export function notifyInputSettingsChanged(): Promise<void> {
  return emit(INPUT_SETTINGS_CHANGED_EVENT).catch(() => {});
}
