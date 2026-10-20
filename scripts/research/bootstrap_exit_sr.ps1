# 지지·저항 청산 연구 - 원클릭 실행(읽기 전용). 저장소 위치를 자동 확인하고, 없으면 별도 연구 폴더에 받은 뒤 한 번에 실행한다.
# 운영 폴더(autotrader)는 읽기만 한다. 주문·엔진 파일·예약 작업·원장 쓰기 없음. 부족한 조건이 있으면 정확한 원인만 출력하고 중단한다.
param(
  [string]$Autotrader = 'C:\Users\goodb\autotrader',
  [string]$Work = 'C:\Users\goodb\exit_sr_study',
  [string]$Branch = 'research/exit-support-resistance',
  [string]$Remote = 'https://github.com/goodbyestarwars/tistory-ticker.git',
  [string]$Mode = 'all',          # universe(검색기 포착 이력 전체, 우선) | ledger(실제 원장) | all
  [string]$HitsFile = '',         # 전체 포착 이력 JSON(선택). 없으면 공개 API(검색기당 최대 1500건)
  [int]$HoldDays = 4,
  [switch]$AllowMarketHours
)
$ErrorActionPreference = 'Stop'
function Fail($code, $msg) { Write-Host "[실행 불가:$code] $msg"; exit 2 }

if ($Work.TrimEnd('\').ToLower().StartsWith($Autotrader.TrimEnd('\').ToLower())) { Fail 'WORK_INSIDE_AUTOTRADER' "작업 폴더가 운영 폴더 안입니다: $Work" }
if (-not (Test-Path -LiteralPath $Autotrader)) { Fail 'NO_AUTOTRADER_DIR' "운영 폴더가 없습니다: $Autotrader" }

# 1) python
$py = $null
foreach ($c in @('py -3', 'python', 'python3')) {
  $exe = $c.Split(' ')[0]
  if (Get-Command $exe -ErrorAction SilentlyContinue) {
    $v = (& cmd /c "$c --version 2>&1")
    if ($v -match 'Python 3\.(\d+)' -and [int]$Matches[1] -ge 8) { $py = $c; break }
  }
}
if (-not $py) { Fail 'NO_PYTHON' 'Python 3.8 이상을 찾지 못했습니다(py -3 / python / python3 모두 실패). 설치 후 PATH에 등록하세요' }

# 2) 저장소 위치: 연구 폴더의 전용 사본을 쓴다(사용자의 다른 clone·작업 중 변경은 건드리지 않는다)
$repo = Join-Path $Work 'repo'
New-Item -ItemType Directory -Force -Path $Work | Out-Null
if (-not (Test-Path (Join-Path $repo '.git'))) {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'NO_GIT' 'git 이 없습니다. Git for Windows 설치 후 다시 실행하세요' }
  & git clone --branch $Branch --single-branch $Remote $repo 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail 'CLONE_FAILED' "clone 실패(저장소 접근 권한/네트워크 확인): $Remote" }
} else {
  & git -C $repo fetch origin $Branch 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail 'FETCH_FAILED' 'git fetch 실패(네트워크/권한)' }
  & git -C $repo checkout $Branch 2>&1 | Out-Host
  & git -C $repo merge --ff-only "origin/$Branch" 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { Fail 'REPO_DIVERGED' "연구 전용 사본이 원격과 갈라졌습니다. $repo 를 지우고 다시 실행하세요(연구 사본이라 안전)" }
}
Write-Host ("연구 코드 버전: " + (& git -C $repo log --oneline -1))

# 3) 실행 (사전점검 -> 스냅샷 -> 일봉 캐시 자동 확보 -> 분봉 조회 전용 -> 분석 -> RESULT.md)
$script = Join-Path $repo 'scripts\research\exit_sr_run_all.py'
$cmd = "$py `"$script`" --autotrader `"$Autotrader`" --work `"$Work`""
$cmd += " --mode $Mode --hold-days $HoldDays"
if ($HitsFile) { $cmd += " --hits-file `"$HitsFile`"" }
if ($AllowMarketHours) { $cmd += ' --allow-market-hours' }
& cmd /c $cmd
exit $LASTEXITCODE
