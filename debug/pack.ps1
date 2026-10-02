# debug/pack.ps1 - package plugin zip (v1.3.0)
$stage_root = 'C:\Users\Lenovo\AppData\Local\Temp\opencode\zip-stage'
$stage = Join-Path $stage_root 'MoeKoe-Music-SearchTips'
if (Test-Path $stage_root) { Remove-Item $stage_root -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$src = 'C:\Users\Lenovo\Documents\Default Project\MoeKoe-Music-SearchTips'
$files = @('manifest.json','content.js','popup.html','popup.js','search-suggest.css','README.md','LICENSE')
foreach ($f in $files) { Copy-Item (Join-Path $src $f) $stage -Force }
Copy-Item (Join-Path $src 'icons') (Join-Path $stage 'icons') -Recurse -Force
$zip = 'C:\Users\Lenovo\Documents\Default Project\MoeKoe-Music-SearchTips\MoeKoe-Music-SearchTips-v1.3.0.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip
Remove-Item 'C:\Users\Lenovo\Documents\Default Project\MoeKoe-Music-SearchTips\MoeKoe-Music-SearchTips-v1.2.1.zip' -Force -ErrorAction SilentlyContinue
Write-Output ('ZIP=' + $zip + ' SIZE=' + (Get-Item $zip).Length)
