# 지지·저항 청산 연구 - 운영 PC 한 번 실행 스크립트 (읽기 전용, 주문 없음)
# 사용: PowerShell 에서  .\run_exit_sr_local.ps1
# 하는 일: 장부 스냅샷(온라인 백업) -> 엔진 해시 대조 -> 키움 1분봉 조회(조회 전용) -> A/A_cycle/B_SR/C_SR 비교
# 하지 않는 일: 주문, live_runner/live_engine 수정, 예약 작업 변경, 운영 DB 쓰기, 업로드
param(
  [string]$Autotrader = 'C:\Users\goodb\autotrader',
  [string]$Work = 'C:\Users\goodb\exit_sr_study',          # autotrader 운영 폴더와 분리
  [string]$NaverCache = 'C:\Users\goodb\exit_strategy\naver',  # 네이버 5년 일봉 캐시 폴더(005930.json 등)
  [string]$Repo = 'C:\Users\goodb\tistory-ticker'            # 저장소 clone, research/exit-support-resistance 브랜치
)
$ErrorActionPreference = 'Stop'
$r = Join-Path $Repo 'scripts\research'
$py = 'python'
Write-Host '1/3 extract (스냅샷 + 해시 대조 + 거래 목록)'
& $py "$r\exit_sr_local.py" extract $Autotrader $Work (Join-Path $Repo 'quant-autotrade\local_bot\live_engine.py')
Write-Host '2/3 bars (키움 1분봉 조회 전용; 키는 .env 에서만 읽고 출력하지 않음)'
& $py "$r\exit_sr_local.py" bars $Work (Join-Path $Autotrader '.env') $NaverCache
Write-Host '3/3 analyze'
& $py "$r\exit_sr_local.py" analyze $Work $NaverCache '352820,441270,089590'
Write-Host "완료. 올려도 되는 익명 요약: $Work\out\summary.json, trades_abc.csv, cases.json, coverage.json 과 $Work\engine_check.json"
Write-Host "올리면 안 되는 것: $Work\snapshots (원장 사본), minbars, .env"
