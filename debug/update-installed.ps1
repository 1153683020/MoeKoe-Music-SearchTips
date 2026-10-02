# debug/update-installed.ps1 - sync v1.3.0 files into the installed MoeKoe extensions dir
$src = 'C:\Users\Lenovo\Documents\Default Project\MoeKoe-Music-SearchTips'
$dst = 'C:\Users\Lenovo\AppData\Roaming\moekoemusic\extensions\MoeKoe-Music-SearchTips'
$files = @('manifest.json','content.js','popup.html','popup.js','search-suggest.css','README.md')
foreach ($f in $files) { Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force }
# v1.3.0 removed files
$removed = @('background.js','relay.html','relay.js')
foreach ($f in $removed) {
  $p = Join-Path $dst $f
  if (Test-Path $p) { Remove-Item $p -Force }
}
Write-Output 'INSTALLED-UPDATED'
Get-ChildItem $dst -File | Where-Object { $_.Name -match '^(manifest|content|popup|relay|search-suggest|background|README)' } | Select-Object Name, Length | Format-Table -AutoSize
