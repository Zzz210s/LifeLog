# -*- coding: utf-8 -*-
"""托盘图标与原生右键菜单的程序化驱动(LifeLog 验收用)。

为什么需要它:托盘不是 CDP 能点的地方 —— 它是 tray-icon 用 Shell_NotifyIcon 注册的图标
(顶层窗口类 tray_icon_app)+ TrackPopupMenu 弹出的原生菜单(窗口类 #32768)。
本机任务栏自动隐藏,真实鼠标右键可能落在空处,所以菜单走 shell 发给托盘窗口的同一条消息
WM_USER_TRAYICON(6002) + lParam=WM_RBUTTONUP;菜单弹出后无法用 UI Automation 取项
(菜单在模态循环里,UIA 查到 0 个子项),改用菜单自己的消息接口:向菜单窗口 PostMessage
WM_KEYDOWN(VK_DOWN x 序号,再 VK_RETURN)—— 从无选中态起第一次 VK_DOWN 落第 1 项,
所以「第 n 项」= VK_DOWN 发 n 次再 ENTER(实测 Down x2 -> 第 2 项「打开主窗口」)。

用法:
  python scripts/win-tray.py rect <pid>           列出托盘图标矩形(JSON)
  python scripts/win-tray.py pick <pid> <序号>     弹出托盘菜单并选中第 n 项(1 起;返回菜单是否关闭)
  python scripts/win-tray.py click <pid>          真实鼠标左键单击托盘图标(输入栏显隐切换)
  python scripts/win-tray.py toggle <pid>         同一消息路径的 WM_LBUTTONUP(真实点击落空时兜底)
  python scripts/win-tray.py menus <pid>          列出当前 #32768 菜单窗口
"""
import ctypes
import json
import sys
import time
from ctypes import wintypes

u32 = ctypes.windll.user32
shell32 = ctypes.windll.shell32
u32.SetProcessDPIAware()
EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
WM_USER_TRAYICON = 6002
WM_KEYDOWN = 0x0100
WM_RBUTTONUP = 0x0205
WM_LBUTTONUP = 0x0202
VK_DOWN, VK_RETURN = 0x28, 0x0D
SCAN_DOWN, SCAN_RETURN = 0x50, 0x1C
MENU_CLASS = '#32768'
MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004


class NOTIFYICONIDENTIFIER(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.DWORD), ('hWnd', wintypes.HWND),
                ('uID', wintypes.DWORD), ('guid', ctypes.c_byte * 16)]


def class_of(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    u32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def pid_of(hwnd):
    out = wintypes.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(out))
    return out.value


def list_windows(pid, cls=None):
    out = []

    def cb(hwnd, _):
        if pid_of(hwnd) == pid and (cls is None or class_of(hwnd) == cls):
            out.append(int(hwnd))
        return True

    u32.EnumWindows(EnumWindowsProc(cb), 0)
    return out


def icon_rect(hwnd, uid):
    nid = NOTIFYICONIDENTIFIER()
    nid.cbSize = ctypes.sizeof(NOTIFYICONIDENTIFIER)
    nid.hWnd = hwnd
    nid.uID = uid
    r = wintypes.RECT()
    if shell32.Shell_NotifyIconGetRect(ctypes.byref(nid), ctypes.byref(r)) == 0:
        return [r.left, r.top, r.right, r.bottom]
    return None


def find_icon(pid):
    for h in list_windows(pid, 'tray_icon_app'):
        for uid in range(0, 6):
            r = icon_rect(h, uid)
            if r:
                return h, uid, r
    return None


def wait_menus(pid, tries=30, gap=0.05):
    for _ in range(tries):
        menus = list_windows(pid, MENU_CLASS)
        if menus:
            return menus
        time.sleep(gap)
    return []


def key(hwnd, vk, scan):
    u32.PostMessageW(hwnd, WM_KEYDOWN, vk, 1 | (scan << 16))


def main():
    cmd, pid = sys.argv[1], int(sys.argv[2])
    hit = find_icon(pid)
    if hit is None:
        print(json.dumps({'ok': False, 'error': 'tray icon not found'}))
        return 2
    hwnd, uid, r = hit
    cx, cy = (r[0] + r[2]) // 2, (r[1] + r[3]) // 2
    if cmd == 'rect':
        print(json.dumps({'ok': True, 'hwnd': hwnd, 'uID': uid, 'rect': r}))
    elif cmd == 'menus':
        print(json.dumps({'ok': True, 'menus': [hex(h) for h in list_windows(pid, MENU_CLASS)]}))
    elif cmd == 'toggle':
        u32.PostMessageW(hwnd, WM_USER_TRAYICON, 0, WM_LBUTTONUP)
        print(json.dumps({'ok': True, 'via': 'message'}))
    elif cmd == 'click':
        u32.SetCursorPos(cx, cy)
        time.sleep(0.25)
        u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, ctypes.c_void_p(0))
        time.sleep(0.06)
        u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, ctypes.c_void_p(0))
        print(json.dumps({'ok': True, 'via': 'mouse', 'center': [cx, cy]}))
    elif cmd == 'pick':
        index = int(sys.argv[3])
        u32.SetCursorPos(cx, cy)
        time.sleep(0.25)
        u32.PostMessageW(hwnd, WM_USER_TRAYICON, 0, WM_RBUTTONUP)
        menus = wait_menus(pid)
        if not menus:
            print(json.dumps({'ok': False, 'error': 'menu did not open'}))
            return 3
        mh = menus[0]
        for _ in range(index):
            key(mh, VK_DOWN, SCAN_DOWN)
            time.sleep(0.12)
        invoked_at = time.time() * 1000.0  # 菜单项真正被选中的时刻(给「主窗首开耗时」做参考点)
        left = []
        for _ in range(3):  # 回车偶尔会被吞,重发同一次即可(选中项不变)
            key(mh, VK_RETURN, SCAN_RETURN)
            time.sleep(0.35)
            left = wait_menus(pid, tries=8)
            if not left:
                break
        via = 'key'
        if left:  # 三次都没选中:回退真实鼠标点击(按菜单高度/4 估算该项中心)
            r = wintypes.RECT()
            if u32.GetWindowRect(mh, ctypes.byref(r)) and r.bottom > r.top:
                y = r.top + int((r.bottom - r.top) * (index - 0.5) / 4)
                u32.SetCursorPos((r.left + r.right) // 2, y)
                time.sleep(0.2)
                u32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, ctypes.c_void_p(0))
                time.sleep(0.05)
                u32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, ctypes.c_void_p(0))
                time.sleep(0.35)
                left = wait_menus(pid, tries=8)
                via = 'mouse'
        print(json.dumps({'ok': True, 'menu': hex(mh), 'index': index, 'invoked_at': int(invoked_at),
                          'via': via, 'closed': not left, 'left': [hex(h) for h in left]}))
    else:
        raise SystemExit('unknown command: ' + cmd)
    return 0


if __name__ == '__main__':
    sys.exit(main())
