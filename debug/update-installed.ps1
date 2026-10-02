# debug/update-installed.ps1 - copy fixed plugin files into the installed MoeKoe extensions dir
$src = 'C:\Users\Lenovo\Documents\Default Project\MoeKoe-Music-SearchTips'
$dst = 'C:\Users\Lenovo\AppData\Roaming\moekoemusic\extensions\MoeKoe-Music-SearchTips'
$files = @('manifest.json','background.js','content.js','popup.html','popup.js','relay.html','relay.js','search-suggest.css','README.md')
foreach ($f in $files) { Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force }
Write-Output 'INSTALLED-UPDATED'
Get-ChildItem $dst -File | Where-Object { $_.Name -match '^(manifest|background|content|popup|relay|search-suggest|README)' } | Select-Object Name, Length | Format-Table -AutoSize
