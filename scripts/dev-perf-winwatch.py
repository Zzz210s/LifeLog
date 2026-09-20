# -*- coding: utf-8 -*-
"""perf 计时用的「时刻观测器」:等某个进程出现 / 某个窗口第一次可见 / 某个窗口不再可见。

为什么需要它:启动耗时的参考点是「进程被创建」「窗口第一次可见」——两者都不是 CDP
能读的(CDP 目标出现晚于窗口可见,且拿不到 pid),所以用一个短命轮询进程按
kernel32/user32 读数打 epoch 毫秒时间戳,由 Node 侧读 stdout 的一行 JSON。
只用 ctypes,无第三方依赖;轮询间隔 2-3ms,误差在同一量级。

用法:
  python scripts/dev-perf-winwatch.py proc <exe名> [超时ms]
      -> 该 exe 进程首次出现: {"kind":"proc","exe":..,"pid":..,"at":epochms}
  python scripts/dev-perf-winwatch.py win <标题> [超时ms] [pid]
      -> 该标题顶层窗口首次可见: {"kind":"win","title":..,"pid":..,"hwnd":..,"at":epochms}
  python scripts/dev-perf-winwatch.py gone <标题> [超时ms]
      -> 该标题顶层窗口不再可见: {"kind":"gone","title":..,"at":epochms}
超时输出 {"timeout":true,...} 并以码 1 退出(调用方可据此判定失败而非读到假 0)。
"""
import ctypes
import json
import sys
import time
from ctypes import wintypes

kernel32 = ctypes.windll.kernel32
u32 = ctypes.windll.user32
u32.SetProcessDPIAware()
EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
TH32CS_SNAPPROCESS = 0x00000002
INVALID_HANDLE = ctypes.c_void_p(-1).value


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD), ('th32ProcessID', wintypes.DWORD),
        ('th32DefaultHeapID', ctypes.POINTER(ctypes.c_ulong)), ('th32ModuleID', wintypes.DWORD),
        ('cntThreads', wintypes.DWORD), ('th32ParentProcessID', wintypes.DWORD),
        ('pcPriClassBase', ctypes.c_long), ('dwFlags', wintypes.DWORD),
        ('szExeFile', ctypes.c_wchar * 260),
    ]


def now_ms():
    return int(time.time() * 1000)


def proc_pids(name):
    """按 exe 名枚举 pid(大小写不敏感);快照法比 tasklist 子进程快两个数量级"""
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == INVALID_HANDLE:
        return []
    out = []
    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
    try:
        ok = kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            if entry.szExeFile.lower() == name.lower():
                out.append(entry.th32ProcessID)
            ok = kernel32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snap)
    return out


def window_text(hwnd):
    n = u32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    u32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def window_pid(hwnd):
    out = wintypes.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(out))
    return out.value


def visible_windows(title, pid):
    """标题精确匹配、IsWindowVisible 为真且「在屏上」的顶层窗口 [(hwnd, pid, rect)]。

    为什么要额外排除屏外坐标:本应用/tao 的某些隐藏路径是把窗口挪到 -32000 而
    IsWindowVisible 仍为真(memory #32 的失同步就是这个位),只按 IsWindowVisible
    判定会把「已隐藏」当可见。屏外阈值 -30000 远离任何真实显示器坐标。
    """
    found = []

    def cb(hwnd, _):
        if not u32.IsWindowVisible(hwnd) or window_text(hwnd) != title:
            return True
        rect = wintypes.RECT()
        u32.GetWindowRect(hwnd, ctypes.byref(rect))
        if rect.left <= -30000 or rect.top <= -30000:
            return True
        p = window_pid(hwnd)
        if pid is None or p == pid:
            found.append((int(hwnd), p, [rect.left, rect.top, rect.right, rect.bottom]))
        return True

    u32.EnumWindows(EnumWindowsProc(cb), 0)
    return found


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    kind = sys.argv[1]
    target = sys.argv[2]
    timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 60000
    pid_filter = int(sys.argv[4]) if len(sys.argv) > 4 else None
    deadline = time.time() + timeout / 1000.0
    # 先吐一行 ready:调用方等它再启动被测进程,否则本进程自己的冷启动(解释器 ~300-700ms)
    # 会把「首次枚举到」的时间戳顶到观测能力下限,读数就不是进程创建时刻了。
    print(json.dumps({'kind': 'ready', 'watch': kind, 'target': target, 'at': now_ms()}), flush=True)
    while time.time() < deadline:
        if kind == 'proc':
            pids = proc_pids(target)
            if pids:
                print(json.dumps({'kind': 'proc', 'exe': target, 'pid': pids[0], 'at': now_ms()}))
                return 0
        elif kind == 'win':
            hits = visible_windows(target, pid_filter)
            if hits:
                print(json.dumps({'kind': 'win', 'title': target, 'hwnd': hits[0][0],
                                  'pid': hits[0][1], 'rect': hits[0][2], 'at': now_ms()}))
                return 0
        elif kind == 'gone':
            if not visible_windows(target, pid_filter):
                print(json.dumps({'kind': 'gone', 'title': target, 'at': now_ms()}))
                return 0
        else:
            raise SystemExit('unknown kind: ' + kind)
        time.sleep(0.002 if kind == 'proc' else 0.003)
    print(json.dumps({'timeout': True, 'kind': kind, 'target': target, 'at': now_ms()}))
    return 1


if __name__ == '__main__':
    sys.exit(main())
