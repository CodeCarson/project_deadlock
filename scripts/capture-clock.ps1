$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
public static class ClockCrop {
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect rect);
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  public static string Read(int x, int y, int width, int height, bool preview) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    if (!preview) {
      IntPtr window = GetForegroundWindow(); uint id; GetWindowThreadProcessId(window, out id);
      string process = Process.GetProcessById((int)id).ProcessName.ToLowerInvariant();
      if (process != "deadlock" && process != "citadel") return null;
      Rect bounds; if (!GetWindowRect(window, out bounds)) return null;
      if (x < bounds.Left || y < bounds.Top || x + width > bounds.Right || y + height > bounds.Bottom) return null;
    }
    using (Bitmap image = new Bitmap(width, height)) {
      using (Graphics graphics = Graphics.FromImage(image)) {
        graphics.CopyFromScreen(x, y, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
      }
      using (MemoryStream stream = new MemoryStream()) { image.Save(stream, ImageFormat.Png); return Convert.ToBase64String(stream.ToArray()); }
    }
  }
}
'@ -ReferencedAssemblies System.Drawing,System,System.Core
while ($null -ne ($line = [Console]::ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    if ($request.width -lt 40 -or $request.width -gt 640 -or $request.height -lt 20 -or $request.height -gt 160) { throw 'Invalid crop' }
    $image = [ClockCrop]::Read([int]$request.x, [int]$request.y, [int]$request.width, [int]$request.height, [bool]$request.preview)
    @{ image = $image; observedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) }
  } catch {
    [Console]::WriteLine('{"error":true}')
  }
}
