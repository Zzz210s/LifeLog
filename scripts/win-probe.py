"""窗口级取证小工具(Win32 读数,不依赖任何第三方库)。

为什么需要它:窗口可见性/原生对话框不是 CDP 能读的东西
(CDP 的 document.visibilityState 对已隐藏的 Tauri 窗口仍报 visible),
所以验收脚本用 user32 读数取证。

用法:
  python scripts/win-probe.py list <pid>            顶层窗口 JSON:标题/类名/可见性/物理矩形
  python scripts/win-probe.py close-dialog <pid>    给该进程第一个 #32770 对话框发 WM_CLOSE
  python scripts/win-probe.py close-window <pid> <标题>  给顶层窗口(按标题)发 WM_CLOSE
                                                   (= 点窗口关闭按钮,走应用自己的 CloseRequested 路径)
  python scripts/win-probe.py click-ok <pid>        点该进程 #32770 对话框里文本为「确定/OK」的按钮
  python scripts/win-probe.py hotkey ctrl+shift+q   真实按键(keybd_event,走系统热键链路)
"""
import ctypes
import json
import re
import sys
from ctypes import wintypes

u32 = ctypes.windll.user32
u32.SetProcessDPIAware()

EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
WM_CLOSE = 0x0010
BM_CLICK = 0x00F5
VK = {'ctrl': 0x11, 'shift': 0x10, 'alt': 0x12}
KEYEVENTF_KEYUP = 0x0002


def _text(hwnd):
    n = u32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    u32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def _cls(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    u32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def _pid(hwnd):
    out = wintypes.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(out))
    return out.value


def top_level(pid):
    found = []

    def cb(hwnd, _):
        if _pid(hwnd) != pid:
            return True
        rect = wintypes.RECT()
        u32.GetWindowRect(hwnd, ctypes.byref(rect))
        found.append({
            'title': _text(hwnd),
            'cls': _cls(hwnd),
            'visible': bool(u32.IsWindowVisible(hwnd)),
            'rect': [rect.left, rect.top, rect.right, rect.bottom],
            'hwnd': int(hwnd),
        })
        return True

    u32.EnumWindows(EnumWindowsProc(cb), 0)
    return found


def find_dialog(pid, title=None):
    """该进程的 #32770 对话框;title 非空时按标题包含过滤;优先取可见的那个
    (进程里可能留有已隐藏或未关闭的旧对话框窗口)"""
    dialogs = [w for w in top_level(pid) if w['cls'] == '#32770' and (title is None or title in w['title'])]
    return next((w for w in dialogs if w['visible']), dialogs[0] if dialogs else None)


def children(hwnd):
    out = []

    def cb(child, _):
        out.append(child)
        return True

    u32.EnumChildWindows(hwnd, EnumWindowsProc(cb), 0)
    return out


def main():
    cmd = sys.argv[1]
    pid = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 0
    title = sys.argv[3] if len(sys.argv) > 3 else None
    if cmd == 'list':
        print(json.dumps(top_level(pid), ensure_ascii=False))
    elif cmd == 'close-dialog':
        dlg = find_dialog(pid, title)
        print(json.dumps({'found': bool(dlg), 'title': dlg['title'] if dlg else None, 'closed': bool(dlg) and bool(u32.PostMessageW(dlg['hwnd'], WM_CLOSE, 0, 0))}, ensure_ascii=False))
    elif cmd == 'close-window':
        win = next((w for w in top_level(pid) if w['title'] == title), None)
        print(json.dumps({'found': bool(win), 'title': win['title'] if win else None,
                          'closed': bool(win) and bool(u32.PostMessageW(win['hwnd'], WM_CLOSE, 0, 0))},
                         ensure_ascii=False))
    elif cmd == 'click-ok':
        dlg = find_dialog(pid, title)
        if not dlg:
            print(json.dumps({'found': False}))
            return
        hit = None
        for child in children(dlg['hwnd']):
            if _text(child).replace('&', '') in ('确定', 'OK'):
                hit = child
        if hit:
            u32.SendMessageW(hit, BM_CLICK, 0, 0)
        print(json.dumps({'found': True, 'title': dlg['title'], 'clicked': bool(hit), 'buttons': [_text(c) for c in children(dlg['hwnd']) if _text(c)]}, ensure_ascii=False))
    elif cmd == 'move':
        # move <pid> <title> <x> <y>:把窗口移到指定屏幕坐标(验收还原用;不改尺寸/层级/焦点)
        win = next((w for w in top_level(pid) if w['title'] == title), None)
        x, y = int(sys.argv[4]), int(sys.argv[5])
        SWP = 0x0001 | 0x0004 | 0x0010  # NOSIZE | NOZORDER | NOACTIVATE
        moved = bool(win) and bool(u32.SetWindowPos(win['hwnd'], 0, x, y, 0, 0, SWP))
        after = next((w for w in top_level(pid) if w['title'] == title), None)
        print(json.dumps({'found': bool(win), 'moved': moved, 'rect': after['rect'] if after else None}, ensure_ascii=False))
    elif cmd == 'hotkey':
        combo = sys.argv[2].lower().split('+')
        mods, key = combo[:-1], combo[-1]
        for m in mods:
            u32.keybd_event(VK[m], 0, 0, 0)
        # 功能键(F1-F24)的虚拟码是 0x70 起;其它单字符键用 ASCII
        fn = re.fullmatch(r'f([1-9]|1[0-9]|2[0-4])', key)
        code = 0x70 + int(fn.group(1)) - 1 if fn else ord(key.upper())
        u32.keybd_event(code, 0, 0, 0)
        u32.keybd_event(code, 0, KEYEVENTF_KEYUP, 0)
        for m in reversed(mods):
            u32.keybd_event(VK[m], 0, KEYEVENTF_KEYUP, 0)
        print(json.dumps({'sent': combo}))
    else:
        raise SystemExit('unknown command: ' + cmd)


if __name__ == '__main__':
    main()
