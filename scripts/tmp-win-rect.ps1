param([int64]$Hwnd)
Add-Type @"
using System; using System.Runtime.InteropServices;
public class WR {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
"@
$r = New-Object WR+RECT
[WR]::GetWindowRect([IntPtr]$Hwnd, [ref]$r) | Out-Null
Write-Output ("rect: {0},{1} {2}x{3}" -f $r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T))
