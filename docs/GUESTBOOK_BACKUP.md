# 방명록(대화방) 백업 (2026-11-21)

티스토리 관리자 백업은 댓글·방명록을 포함하지 않는다(안내문 확인). 대화방 글은 티스토리 방명록이 원본이므로
이 사이트가 주 1회 공개 글을 직접 백업한다.

- 코드: `scripts/cloud-vm/guestbook_backup.py`(표준 라이브러리만), 타이머 `setup_guestbookbackup_timer.sh`
  (일요일 03:00 KST = 토요일 18:00 UTC, deploy_check의 `ensure_scan_timers_current`가 자동 설치).
- 저장: 서버 `~/guestbook-backup/guestbook.json`(권한 600, git 작업 폴더 밖, 공개 API 미노출) + 월 1회 `guestbook-YYYY-MM.json` 사본.
- 방식: 매번 전체 페이지를 받아 글 id로 병합한다(전체 받기 비용 ≈ 40KB/0.2초). 새 글은 추가, 기존 글은 덮어쓰지 않는다.
  내용이 바뀌면 이전 내용을 `revisions`에, 화면에서 사라지면 `missingSince`에 기록하고 삭제하지 않는다.
  응답이 비었는데 기존 백업이 있으면 실패 처리(파일 불변). 페이지 상한에 닿으면 사라짐 표시를 하지 않는다.
- 저장 항목: id, 종류(admin/general/secret), 작성자명, 표시 날짜, 본문, 답글, 종목 태그(`[005930]` → `stock`), 처음/마지막 확인 시각.
- 한계: 비밀글 본문·작성자 IP는 공개 화면에 없어 백업되지 않는다. 사라진 글은 백업 시점 이전 것만 남는다(주 1회라 최대 7일 공백).
- 수동 실행: `cd ~/kiwoom-api/scripts/cloud-vm && ../../venv/bin/python guestbook_backup.py [--dry-run] [--dir 경로]`.
- 복구·활용: 대화방 화면 복원(백업에서 표시) 또는 종목별·기간별 추출·Word/엑셀 변환은 필요할 때 별도 작업(내보내기 UI는 아직 없음).
