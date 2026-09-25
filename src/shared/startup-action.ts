// 启动动作的唯一决策点(前端镜像;真机执行在 Rust 侧 windowing/startup.rs,两侧同构同测)。
// 语义见 spec 3.1:手动启动与开机自启一致,动作只由设置「启动时显示」决定;
// 主窗口只在**首次使用引导未看过**时由 Rust 启动路径自动打开(见 windowing/startup.rs);
// 其余情况都不自动显示(关闭 = 退到托盘)。
import type { StartupSettings } from './startup-settings';

/** 启动后做什么:唤起输入栏,或只驻留托盘(不显示任何窗口) */
export type StartupAction = 'show-input' | 'tray-only';

/**
 * 解析启动动作。
 * - 设置为 'tray-only' -> 'tray-only'(静默进托盘)
 * - 其余(含缺失/非法值已由 parseStartupSettings 回退为 'input-bar')-> 'show-input'
 * launchedByAutostart 是本次拉起方式(自启会带 --minimized):两种方式动作一致,
 * 故它不参与判定,只作为调用方传入的事实;保留入参以免两侧签名漂移。
 */
export function resolveStartupAction(
  settings: StartupSettings,
  _launchedByAutostart: boolean,
): StartupAction {
  return settings.startupShow === 'tray-only' ? 'tray-only' : 'show-input';
}
