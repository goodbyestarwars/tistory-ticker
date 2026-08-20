#!/bin/bash
# 2026-08-20: kiwoom-deploy.service(deploy_check.sh를 5분마다 돌리는 기존 서비스, 이
# 저장소에 유닛 파일이 없어 VM에만 수동으로 설정돼 있었음)가 Type=oneshot인데 KillMode를
# 따로 안 정해서 systemd 기본값(control-group)이 적용되고 있었다. deploy_check.sh는
# 배포 직후 strategy_scan.py/rescan_patterns.py를 `&`+`disown`으로 백그라운드에 띄우는데
# (run_search_scan_refresh_after_deploy, 새 검색 규칙이 다음 날 배치까지 안 기다리고
# 바로 반영되게 하려는 용도), disown은 bash job control에서만 분리시킬 뿐 systemd의
# cgroup 추적에서는 안 빠진다 - 그래서 deploy_check.sh 본체가 끝나 서비스가
# "Deactivated"로 처리되는 순간 같은 cgroup에 남아있던 방금 띄운 스캔까지 통째로 죽었다.
# 실측 확인(2026-08-20): search-scan-refresh.log에 "started"만 5시간 동안 10번 찍히고
# "finished"가 단 한 번도 없었고, journalctl에는 deploy_check.sh 본체가 끝난 지 1초 만에
# "Deactivated successfully"가 찍혀 있었다 - 매 배포마다 반복되는 구조적 버그였다.
#
# 기존 유닛 파일 전체를 다시 쓰지 않고(내용을 확실히 몰라 실수로 다른 설정을 지울 위험),
# drop-in override로 KillMode=process만 안전하게 추가한다 - 이러면 systemd는
# ExecStart로 띄운 메인 프로세스가 끝났는지만 보고, 그 자식이 새로 fork/disown한 별도
# 프로세스는 cgroup에 남아 있어도 안 건드린다.
#
# VM에서 한 번만 실행하면 됨: bash scripts/cloud-vm/fix_deploy_service_killmode.sh
set -e

sudo mkdir -p /etc/systemd/system/kiwoom-deploy.service.d
sudo tee /etc/systemd/system/kiwoom-deploy.service.d/killmode-process.conf > /dev/null << 'CONFEOF'
[Service]
KillMode=process
CONFEOF

sudo systemctl daemon-reload

echo "=== 적용 결과 (KillMode=process가 보여야 정상) ==="
systemctl show kiwoom-deploy.service -p KillMode
