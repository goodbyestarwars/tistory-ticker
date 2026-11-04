# 오늘 신규 매수 보류(hold) — VM 에이전트·엔진 작업지시서 (2026-11-04)

대상: Google VM 자동매매 저장소 `autotrader-private`(이 저장소 밖). 이 저장소(Oracle)는 API·화면만 구현했고, **에이전트가 아래를 지원하기 전에는 버튼이 비활성**이다(`snapshot.capabilities`에 `hold`가 없으면 서버가 명령을 거부).
실주문 코드(`live_engine.py`, `ninepay_trade.py`)를 바꾸므로 **diff를 사용자에게 먼저 보이고 승인받은 뒤** 반영한다. 장중 재시작 금지.

## 계약
- 명령(`/autotrader/agent/sync` 응답의 `command`): `{id, action:'hold', day:'YYYY-MM-DD', scope:'buy'}` / `{id, action:'resume'}`. 서버는 `day`를 KST 오늘로 채운다.
- 에이전트: `hold` → `~/autotrader/HOLD_BUY` 파일에 `{"day":"<day>","scope":"buy"}` 원자 저장. `resume` → 파일 삭제. 처리 후 `ack {id, ok, reason}`.
- 상태 보고: `snapshot.capabilities` 에 `"hold"` 추가, `snapshot.flags.hold` = 파일 내용(없으면 null). 서버는 `flags.hold.day`가 오늘(KST)일 때만 보류 중으로 본다.

## 엔진 (diff 승인 필요)
- 신규 매수 판단 직전(`live_engine.engine_cycle`의 진입 구간, `ninepay_trade`의 신규 매수 구간)에서 `HOLD_BUY`를 읽는다. `day == 오늘(KST)`이면 신규 매수만 건너뛰고 skip 사유 `HOLD_BUY`를 기록한다(`ledger.skip`).
- **청산(매도) 점검과 기존 미체결·장부 정합 로직은 건드리지 않는다.** 기존 `STOP` 파일 동작도 그대로 둔다.
- 파일을 읽지 못하거나 형식이 틀리면 **보류로 간주**(안전 방향). 날짜가 오늘이 아니면 무시(자정 이후 자동 해제).
- 텔레그램 `tg_live_status.BLOCKING`에 `HOLD_BUY`(수준 info/warn, "오늘 신규 매수 보류 중 — 사용자가 설정")를 추가하면 응답없음·막힘 경고와 구분된다.

## 검증
- 단위: 오늘 날짜/어제 날짜/깨진 파일/파일 없음 4가지에서 매수만 막히고 매도 경로는 동일.
- 에이전트: hold→파일 생성+ack, resume→삭제+ack, 어제 날짜 파일은 `flags.hold`로 올라가도 서버가 비활성으로 표시.
- 배포는 장외, 승인 파일·`.env`·`*.db` 무변경.

## 추가 요청: 중지 = 오늘만 (타이머 유지) — 사용자 의도 "조작하지 않으면 자동 시작"
- 현재 `stop`은 서비스를 멈추고 **타이머도 끈다**(2026-11-04 10:20 중지 → 10:27 시작으로 복구한 기록으로 확인). 사용자 의도는 기본이 항상 자동 시작이고 중지는 당일 한정이다.
- 제안: `stop`은 `autotrader-live.service`만 정지하고 타이머는 켠 채로 둔다(오늘 08:55 타이머는 이미 지나 재실행되지 않음, 다음 거래일 08:55에 자동 시작). 장기 중단이 필요하면 별도 "자동 시작 끄기" 명령을 두거나 hold를 쓴다.
- 이 변경이 반영되면 `js/auto-trader.js` 중지 확인문(`CONFIRM.stop`)과 상태 줄 문구를 함께 바꾼다.
- 알림: 사용자가 직접 `stop`한 경우 `tg_live_status`의 "runner 응답 없음"은 30분마다 반복하지 않고 "직접 중지됨" 1회로 대체한다(에이전트가 `lastCommand`/중지 시각을 상태에 싣거나, 봇이 `systemctl show -p Result,ExecMainStatus`의 `signal/15`를 수동 중지로 해석).
