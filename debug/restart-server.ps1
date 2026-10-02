# debug/restart-server.ps1 - 重启调试服务器
$old = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq 4328 }
if ($old) { Stop-Process -Id 4328 -Force; Start-Sleep -Milliseconds 500 }
$p = Start-Process node -ArgumentList 'server.js' -WorkingDirectory 'C:\Users\Lenovo\Documents\Default Project\MoeKoe-Music-SearchTips\debug' -PassThru -WindowStyle Hidden
Write-Output ('PID=' + $p.Id)
