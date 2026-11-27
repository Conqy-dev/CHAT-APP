param([string]$File, [string]$Filter = "", [int]$Goto = 0, [string]$Out, [int]$Wait = 8)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[W]::SetProcessDPIAware() | Out-Null
$args = @("-r", $File)
if ($Filter) { $args += @("-Y", $Filter) }
if ($Goto -gt 0) { $args += @("-g", "$Goto") }
$p = Start-Process "C:\Program Files\Wireshark\Wireshark.exe" -ArgumentList $args -PassThru
for ($i = 0; $i -lt 40 -and $p.MainWindowHandle -eq 0; $i++) { Start-Sleep -Milliseconds 500; $p.Refresh() }
Start-Sleep -Seconds $Wait
$h = $p.MainWindowHandle
[W]::ShowWindow($h, 3) | Out-Null          # maximize
[W]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Seconds 2
$r = New-Object W+RECT; [W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc(); [W]::PrintWindow($h, $hdc, 2) | Out-Null; $g.ReleaseHdc($hdc)   # render the window itself, even if covered
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Stop-Process -Id $p.Id
"saved $Out ($w x $ht)"
