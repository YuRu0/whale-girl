# Codex window tracker for the intro overlay.
# Prints one line whenever the Codex main window changes:
#   R <x> <y> <w> <h>   visible frame in physical pixels (DWM extended frame bounds)
#   MIN                 window is minimized
#   NONE                no Codex window yet
# Argument -Restore: restore + foreground the window once when first found.
param([switch]$Restore)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -Namespace WT -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr v);
[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(System.IntPtr h, int a, out RECT r, int s);
public struct RECT { public int L, T, R, B; }
'@
[WT.U]::SetProcessDpiAwarenessContext([System.IntPtr]::new(-4)) | Out-Null
$h = [System.IntPtr]::Zero
$last = ''
$restored = $false
$findAt = 0
while ($true) {
  if ($h -eq [System.IntPtr]::Zero -or -not [WT.U]::IsWindow($h)) {
    $h = [System.IntPtr]::Zero
    if ([Environment]::TickCount -ge $findAt) {
      $p = Get-Process ChatGPT | Where-Object { $_.MainWindowHandle -ne 0 -and (-not $_.Path -or $_.Path -like '*OpenAI.Codex*') } | Select-Object -First 1
      if ($p) { $h = $p.MainWindowHandle }
      $findAt = [Environment]::TickCount + 400
    }
  }
  if ($h -eq [System.IntPtr]::Zero) { $line = 'NONE' }
  else {
    if ($Restore -and -not $restored) {
      if ([WT.U]::IsIconic($h)) { [WT.U]::ShowWindow($h, 9) | Out-Null }
      [WT.U]::SetForegroundWindow($h) | Out-Null
      $restored = $true
    }
    if ([WT.U]::IsIconic($h)) { $line = 'MIN' }
    else {
      $r = New-Object WT.U+RECT
      [WT.U]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) | Out-Null
      $line = 'R {0} {1} {2} {3}' -f $r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T)
    }
  }
  if ($line -ne $last) { [Console]::Out.WriteLine($line); [Console]::Out.Flush(); $last = $line }
  Start-Sleep -Milliseconds 50
}
