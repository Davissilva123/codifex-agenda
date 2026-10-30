Add-Type -AssemblyName System.Drawing
$exe = Join-Path $PSScriptRoot "..\release\desktop\win-unpacked\CODIFEX AGENDAS.exe"
$out = Join-Path $PSScriptRoot "..\extracted_icon.png"
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
$bmp = $icon.ToBitmap()
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$icon.Dispose()
Write-Host "Extraido com sucesso para $out"
