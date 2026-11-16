# debug/pack.ps1 - package plugin zip (v1.4.0) with forward-slash entry names
$stage_root = 'C:\Users\Lenovo\AppData\Local\Temp\opencode\zip-stage'
$stage = Join-Path $stage_root 'MoeKoe-Music-SearchTips'
if (Test-Path $stage_root) { Remove-Item $stage_root -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$src = 'C:\Users\Lenovo\Documents\Default Project\MoeKoe-Music-SearchTips'
$files = @('manifest.json','content.js','main-world.js','popup.html','popup.js','relay.html','relay.js','search-suggest.css','README.md','LICENSE')
foreach ($f in $files) { Copy-Item (Join-Path $src $f) $stage -Force }
Copy-Item (Join-Path $src 'icons') (Join-Path $stage 'icons') -Recurse -Force

$zip = 'C:\Users\Lenovo\Documents\Default Project\MoeKoe-Music-SearchTips\MoeKoe-Music-SearchTips-v1.4.0.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
Get-ChildItem $stage -Recurse -File | ForEach-Object {
  $rel = 'MoeKoe-Music-SearchTips/' + $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $rel) | Out-Null
}
$archive.Dispose()

Remove-Item 'C:\Users\Lenovo\Documents\Default Project\MoeKoe-Music-SearchTips\MoeKoe-Music-SearchTips-v1.3.2.zip' -Force -ErrorAction SilentlyContinue
Write-Output ('ZIP=' + $zip + ' SIZE=' + (Get-Item $zip).Length)

# verify entry names
$check = [System.IO.Compression.ZipFile]::OpenRead($zip)
Write-Output '--- ENTRIES ---'
$check.Entries | Select-Object -First 10 -ExpandProperty FullName
$check.Dispose()
