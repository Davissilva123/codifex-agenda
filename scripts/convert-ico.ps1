Add-Type -AssemblyName System.Drawing

$pngPath = Join-Path $PSScriptRoot "..\public\icon.png"
$icoPath = Join-Path $PSScriptRoot "..\public\icon.ico"

$bmp = [System.Drawing.Bitmap]::FromFile($pngPath)
$hIcon = $bmp.GetHicon()
$ico = [System.Drawing.Icon]::FromHandle($hIcon)

$fs = [System.IO.File]::OpenWrite($icoPath)
$ico.Save($fs)
$fs.Close()

$ico.Dispose()
$bmp.Dispose()

Write-Output "ICO gerado com sucesso em: $icoPath"
