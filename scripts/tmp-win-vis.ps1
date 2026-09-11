param([int]$ProcId)
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
using System.Collections.Generic;
public class WinEnum {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public static List<string> Result = new List<string>();
  static bool Cb(IntPtr h, IntPtr l) {
    uint pid; GetWindowThreadProcessId(h, out pid);
    if (pid == (uint)l) {
      int len = GetWindowTextLength(h);
      var sb = new StringBuilder(len + 1); GetWindowText(h, sb, sb.Capacity);
      Result.Add((IsWindowVisible(h) ? "VIS " : "hid ") + h + " [" + sb.ToString() + "]");
    }
    return true;
  }
  public static void Run(int pid) { EnumWindows(Cb, (IntPtr)pid); }
}
"@
[WinEnum]::Run($ProcId)
$pid2 = $ProcId
$all = [WinEnum]::Result | Where-Object { $_ -notmatch '^\w+ \d+ \[\]$' }
Write-Output ("proc " + $ProcId + " windows:")
if ($all) { $all } else { Write-Output "  (no titled top-level windows)" }
