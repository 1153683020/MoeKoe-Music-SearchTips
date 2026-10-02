# debug/run-tests.ps1 - run harness E2E tests (headless Edge)
$profile_dir = 'C:\Users\Lenovo\AppData\Local\Temp\opencode\edge-profile2'
if (Test-Path $profile_dir) { Remove-Item $profile_dir -Recurse -Force -ErrorAction SilentlyContinue }
$out = 'C:\Users\Lenovo\AppData\Local\Temp\opencode\harness-out3.html'
if (Test-Path $out) { Remove-Item $out -Force -ErrorAction SilentlyContinue }
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$args = @(
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  ('--user-data-dir=' + $profile_dir),
  '--virtual-time-budget=40000',
  '--dump-dom',
  'http://127.0.0.1:8931/debug/index.html?auto=1'
)
$p = Start-Process -FilePath $edge -ArgumentList $args -RedirectStandardOutput $out -Wait -PassThru -WindowStyle Hidden
Write-Output ('EXITCODE=' + $p.ExitCode + ' OUTSIZE=' + (Get-Item $out).Length)
