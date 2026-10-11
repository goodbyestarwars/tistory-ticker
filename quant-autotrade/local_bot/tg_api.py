# -*- coding: utf-8 -*-
"""Telegram Bot API 최소 클라이언트(표준 라이브러리 urllib, 외부 패키지 없음).

- 이 PC에서 api.telegram.org 로 나가는 HTTPS 요청만 쓴다(롱 폴링). 외부에서 들어오는 포트는 없다.
- 예외 문구에는 요청 주소(토큰이 들어 있음)를 절대 넣지 않는다. 그래도 한 번 더 redact 한다.
- TelegramError.ambiguous: 요청이 서버에 닿은 뒤 응답을 못 받은 경우(읽기 시간 초과·연결 끊김). 전송이 이미 됐을 수 있어
  재시도하면 같은 메시지가 두 번 갈 수 있다는 뜻이다(연결 자체가 안 된 실패는 False).
"""
import json
import socket
import urllib.error
import urllib.request

from tg_config import DEFAULT_API_BASE, redact

UA = 'AutoTraderMonitor/1'


class TelegramError(Exception):
    def __init__(self, message, code=None, retry_after=None, transient=True, ambiguous=False):
        super().__init__(message)
        self.code = code
        self.retry_after = retry_after
        self.transient = transient
        self.ambiguous = ambiguous


class TelegramAPI:
    def __init__(self, token, api_base=DEFAULT_API_BASE):
        if not token:
            raise ValueError('텔레그램 봇 토큰이 비어 있습니다')
        self._token = token
        self._base = api_base.rstrip('/')

    def call(self, method, params=None, timeout=15):
        body = json.dumps(params or {}, ensure_ascii=False).encode('utf-8')
        req = urllib.request.Request('%s/bot%s/%s' % (self._base, self._token, method), data=body, method='POST',
                                     headers={'Content-Type': 'application/json; charset=utf-8', 'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                payload = json.loads(res.read().decode('utf-8'))
        except urllib.error.HTTPError as exc:
            detail, retry_after = '', None
            try:
                data = json.loads(exc.read().decode('utf-8', 'ignore'))
                detail = str(data.get('description') or '')
                retry_after = (data.get('parameters') or {}).get('retry_after')
            except (ValueError, OSError):
                pass
            transient = exc.code == 429 or exc.code >= 500
            raise TelegramError(redact('%s HTTP %s %s' % (method, exc.code, detail)), code=exc.code, retry_after=retry_after, transient=transient) from None
        except urllib.error.URLError as exc:
            reason = exc.reason
            # 연결 단계에서 막힌 실패(DNS·거부)는 전송되지 않았다. 그 외(시간 초과·끊김)는 이미 서버에 닿았을 수 있다.
            ambiguous = not isinstance(reason, (socket.gaierror, ConnectionRefusedError))
            raise TelegramError(redact('%s 연결 실패: %s' % (method, type(reason).__name__)), ambiguous=ambiguous) from None
        except (socket.timeout, TimeoutError, ConnectionError, OSError) as exc:
            raise TelegramError(redact('%s 통신 오류: %s' % (method, type(exc).__name__)), ambiguous=True) from None
        except ValueError:
            raise TelegramError('%s 응답 해석 실패' % method, ambiguous=True) from None
        if not isinstance(payload, dict) or not payload.get('ok'):
            code = payload.get('error_code') if isinstance(payload, dict) else None
            desc = str((payload or {}).get('description') or '') if isinstance(payload, dict) else ''
            retry_after = ((payload or {}).get('parameters') or {}).get('retry_after') if isinstance(payload, dict) else None
            raise TelegramError(redact('%s 실패 %s %s' % (method, code, desc)), code=code, retry_after=retry_after, transient=bool(code == 429 or (code or 0) >= 500))
        return payload.get('result')

    # ---- 자주 쓰는 메서드 ----
    def get_me(self):
        return self.call('getMe')

    def get_updates(self, offset=None, timeout=25):
        params = {'timeout': timeout, 'allowed_updates': ['message', 'callback_query']}
        if offset is not None:
            params['offset'] = offset
        return self.call('getUpdates', params, timeout=timeout + 10)

    def send_message(self, chat_id, text, parse_mode='HTML', reply_markup=None, silent=False):
        params = {'chat_id': chat_id, 'text': text, 'disable_web_page_preview': True}
        if parse_mode:
            params['parse_mode'] = parse_mode
        if reply_markup:
            params['reply_markup'] = reply_markup
        if silent:
            params['disable_notification'] = True
        return self.call('sendMessage', params)

    def answer_callback(self, callback_id, text=None):
        params = {'callback_query_id': callback_id}
        if text:
            params['text'] = text
        return self.call('answerCallbackQuery', params)

    def set_my_commands(self, commands):
        return self.call('setMyCommands', {'commands': [{'command': c, 'description': d} for c, d in commands]})

    def set_menu_button_commands(self):
        return self.call('setChatMenuButton', {'menu_button': {'type': 'commands'}})

    def delete_webhook(self):
        return self.call('deleteWebhook', {'drop_pending_updates': False})
