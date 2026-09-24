// dev 验收脚本共用的 Win32 观测件:powershell 取 pid + python 驱动原生窗口与托盘。
// 单独成文件的原因:cdp-lib.mjs 的冷启动前置 ensureMain 也要经托盘打开主窗,
// 而 cdp-lib 不能反向依赖场景库(dev-startup-scenes.mjs),故把 os 抽到最底层。
import { spawnSync } from 'node:child_process';

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const py = (...a) => sh('python', a);

export const os = {
  pidOf: () => Number(sh('powershell', ['-NoProfile', '-Command',
    "(Get-Process | Where-Object { $_.ProcessName -match '^lifelog$' } | Select-Object -First 1).Id"]).stdout.trim()),
  wins: (pid) => JSON.parse(py('scripts/win-probe.py', 'list', String(pid)).stdout || '[]'),
  winVisible(pid, title) {
    return !!this.wins(pid).find((w) => w.cls === 'Tauri Window' && w.title === title)?.visible;
  },
  pickTray: (pid, index) => py('scripts/win-tray.py', 'pick', String(pid), String(index)),
  /** 托盘图标是否已注册(冷启动初期可能还没就绪,此时点菜单会报 tray icon not found) */
  trayReady: (pid) => {
    try {
      return JSON.parse(py('scripts/win-tray.py', 'rect', String(pid)).stdout.trim() || '{}').ok === true;
    } catch {
      return false;
    }
  },
  trayClick: (pid, cmd) => py('scripts/win-tray.py', cmd, String(pid)),
  hotkey: () => py('scripts/win-probe.py', 'hotkey', 'ctrl+shift+q'),
  closeWindow: (pid, title) => JSON.parse(py('scripts/win-probe.py', 'close-window', String(pid), title).stdout || '{}'),
  /** 给该进程第一个 #32770 原生对话框发 WM_CLOSE(取消另存为等系统对话框) */
  closeDialog: (pid) => JSON.parse(py('scripts/win-probe.py', 'close-dialog', String(pid)).stdout || '{}'),
};
