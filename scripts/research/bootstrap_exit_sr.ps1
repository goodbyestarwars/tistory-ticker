# Exit support/resistance study - one-click runner (read-only). ASCII-only on purpose: Windows PowerShell 5.1 misreads
# BOM-less UTF-8 Korean text and breaks parsing. Korean explanations are in docs/EXIT_SR_LOCAL_AGENT.md.
# Reads C:\Users\goodb\autotrader only. No orders, no engine/scheduler changes, no DB writes there.
param(
  [string]$Autotrader = 'C:\Users\goodb\autotrader',
  [string]$Work = 'C:\Users\goodb\exit_sr_study',
  [string]$Branch = 'research/exit-support-resistance',
  [string]$Remote = 'https://github.com/goodbyestarwars/tistory-ticker.git',
  [string]$Mode = 'all',          # audit | universe | ledger | all | diagnose
  [string]$HitsFile = '',
  [int]$HoldDays = 4,
  [string]$RealCost = '',
  [switch]$AllowMarketHours
)
$ErrorActionPreference = 'Stop'
# Run git through cmd so that git's progress text on stderr is not turned into a PowerShell error record (PS 5.1 + ErrorActionPreference Stop).
function Git([string]$gitArgs) { & cmd /c "git $gitArgs 2>&1" | Out-Host }
function Fail($code, $msg) { Write-Host "[CANNOT RUN:$code] $msg"; exit 2 }

if ($Work.TrimEnd('\').ToLower().StartsWith($Autotrader.TrimEnd('\').ToLower())) { Fail 'WORK_INSIDE_AUTOTRADER' "Work folder is inside the live folder: $Work" }
if (($Mode -ne 'diagnose') -and (-not (Test-Path -LiteralPath $Autotrader))) { Fail 'NO_AUTOTRADER_DIR' "Live folder not found: $Autotrader" }

# 1) python (3.8+)
$py = $null
foreach ($c in @('py -3', 'python', 'python3')) {
  $exe = $c.Split(' ')[0]
  if (Get-Command $exe -ErrorAction SilentlyContinue) {
    $v = (& cmd /c "$c --version 2>&1")
    if ($v -match 'Python 3\.(\d+)') {
      if ([int]$Matches[1] -ge 8) { $py = $c; break }
    }
  }
}
if (-not $py) { Fail 'NO_PYTHON' 'Python 3.8+ not found (tried py -3, python, python3). Install it and add to PATH.' }

# 2) research-only clone under the work folder (your other clones are never touched)
$repo = Join-Path $Work 'repo'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
$haveRepo = Test-Path (Join-Path $repo '.git')
if (-not $haveRepo) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'NO_GIT' 'git not found. Install Git for Windows and retry.' }
  Git "clone --branch $Branch --single-branch $Remote `"$repo`""
  if ($LASTEXITCODE -ne 0) { Fail 'CLONE_FAILED' "git clone failed (check repo access/network): $Remote" }
}
if ($haveRepo) {
  Git "-C `"$repo`" fetch origin $Branch"
  if ($LASTEXITCODE -ne 0) { Fail 'FETCH_FAILED' 'git fetch failed (network/permission)' }
  Git "-C `"$repo`" checkout $Branch"
  Git "-C `"$repo`" merge --ff-only origin/$Branch"
  if ($LASTEXITCODE -ne 0) { Fail 'REPO_DIVERGED' "Research clone diverged from remote. Delete $repo and rerun (it is a research-only copy)." }
}
Write-Host ('code version: ' + ((& cmd /c "git -C `"$repo`" log --oneline -1") -join ' '))

# 3) run
$script = Join-Path $repo 'scripts\research\exit_sr_run_all.py'
$cmd = "$py `"$script`" --autotrader `"$Autotrader`" --work `"$Work`" --mode $Mode --hold-days $HoldDays"
if ($HitsFile) { $cmd += " --hits-file `"$HitsFile`"" }
if ($RealCost) { $cmd += " --real-cost $RealCost" }
if ($AllowMarketHours) { $cmd += ' --allow-market-hours' }
$ErrorActionPreference = 'Continue'
& cmd /c $cmd
exit $LASTEXITCODE
