$procs = Get-Process
foreach ($p in $procs) {
    try {
        if ($p.Path -and $p.Path.ToLower().Contains("release\desktop")) {
            Write-Host "Matando: $($p.Name) PID: $($p.Id)"
            Stop-Process -Id $p.Id -Force
        }
    } catch {}
}
