param([string]$OutDir)

Add-Type -AssemblyName System.Drawing

function New-Logo([int]$size, [string]$path) {
  $scale = $size / 512.0
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  # Rounded rect background #051a4f, radius 110/512
  $r = 110.0 * $scale
  $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $bgPath.AddArc(0, 0, $d, $d, 180, 90)
  $bgPath.AddArc($size - $d, 0, $d, $d, 270, 90)
  $bgPath.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $bgPath.AddArc(0, $size - $d, $d, $d, 90, 90)
  $bgPath.CloseFigure()
  $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0x05, 0x1A, 0x4F))
  $g.FillPath($bgBrush, $bgPath)

  # Cyan diagonal line (-30,460) -> (460,-30), width 32, opacity 0.8
  $cyanPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(204, 0x00, 0xF0, 0xFF), (32.0 * $scale))
  $x1 = -30.0 * $scale; $y1 = 460.0 * $scale; $x2 = 460.0 * $scale; $y2 = -30.0 * $scale
  # Clip the line to the rounded rect region
  $g.SetClip($bgPath)
  $g.DrawLine($cyanPen, [float]$x1, [float]$y1, [float]$x2, [float]$y2)

  $white = [System.Drawing.Color]::White
  $wBrush = New-Object System.Drawing.SolidBrush($white)

  # Slanted bars forming the X/4 mark
  $p1 = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p1.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF((275 * $scale), (385 * $scale))),
    (New-Object System.Drawing.PointF((450 * $scale), (135 * $scale))),
    (New-Object System.Drawing.PointF((500 * $scale), (135 * $scale))),
    (New-Object System.Drawing.PointF((325 * $scale), (385 * $scale)))
  ))
  $g.FillPath($wBrush, $p1)

  $p2 = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p2.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF((450 * $scale), (385 * $scale))),
    (New-Object System.Drawing.PointF((275 * $scale), (135 * $scale))),
    (New-Object System.Drawing.PointF((325 * $scale), (135 * $scale))),
    (New-Object System.Drawing.PointF((500 * $scale), (385 * $scale)))
  ))
  $g.FillPath($wBrush, $p2)

  # The "4" glyph with even-odd hole
  $four = New-Object System.Drawing.Drawing2D.GraphicsPath
  $four.FillMode = [System.Drawing.Drawing2D.FillMode]::Alternate
  $four.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF((235 * $scale), (135 * $scale))),
    (New-Object System.Drawing.PointF((75 * $scale), (320 * $scale))),
    (New-Object System.Drawing.PointF((235 * $scale), (320 * $scale))),
    (New-Object System.Drawing.PointF((235 * $scale), (385 * $scale))),
    (New-Object System.Drawing.PointF((285 * $scale), (385 * $scale))),
    (New-Object System.Drawing.PointF((285 * $scale), (320 * $scale))),
    (New-Object System.Drawing.PointF((320 * $scale), (320 * $scale))),
    (New-Object System.Drawing.PointF((320 * $scale), (275 * $scale))),
    (New-Object System.Drawing.PointF((285 * $scale), (275 * $scale))),
    (New-Object System.Drawing.PointF((285 * $scale), (135 * $scale)))
  ))
  $four.AddPolygon([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF((235 * $scale), (195 * $scale))),
    (New-Object System.Drawing.PointF((235 * $scale), (275 * $scale))),
    (New-Object System.Drawing.PointF((165 * $scale), (275 * $scale)))
  ))
  $g.FillPath($wBrush, $four)

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "saved $path ($size px)"
}

New-Logo 512 (Join-Path $OutDir 'icon-512.png')
New-Logo 192 (Join-Path $OutDir 'icon-192.png')
New-Logo 180 (Join-Path $OutDir 'apple-touch-icon.png')
New-Logo 256 (Join-Path $OutDir 'favicon-256.png')

# Wrap the 256px PNG into a valid .ico (PNG-compressed ICO entry)
$pngPath = Join-Path $OutDir 'favicon-256.png'
$png = [System.IO.File]::ReadAllBytes($pngPath)
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($ico)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)
$w.Write([byte]0); $w.Write([byte]0)      # 256 -> stored as 0
$w.Write([byte]0); $w.Write([byte]0)
$w.Write([uint16]1); $w.Write([uint16]32)
$w.Write([uint32]$png.Length); $w.Write([uint32]22)
$w.Write($png); $w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'favicon.ico'), $ico.ToArray())
$w.Dispose()
Write-Host "saved favicon.ico"
