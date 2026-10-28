"""Receipt coverage is distinct from registration and exchange timeliness."""
from pathlib import Path
from types import SimpleNamespace
import sys
import time
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/cloud-vm'))
from kiwoom_ws_hub import KiwoomWsHub
from toss_ws_hub import TossWsHub, MAX_CODES


def test_kiwoom_registration_does_not_invent_ticks_and_receipts_are_bounded():
    hub=KiwoomWsHub('synthetic','synthetic',max_codes=2,parse_fn=lambda message:message)
    with patch.object(hub,'_desired',return_value=(['005930','000660'],[])):
        health=hub.health()
        assert health['observedFreshCodes']==0
        assert health['quoteReceipts']['005930']['receivedAt'] is None
        hub._dispatch([dict(code='005930')],time.time())
        assert hub.health()['observedFreshCodes']==1
        hub._dispatch([dict(code='000660'),dict(code='035420')],time.time())
        assert len(hub._last_quote)==2
        hub._last_quote['000660']=time.time()-100
        assert hub.health()['observedFreshCodes']==0


def test_toss_missing_and_stale_receipts_are_not_400_realtime():
    hub=TossWsHub('synthetic','synthetic')
    hub._subscribers={1:SimpleNamespace(codes={'005930'},dropped_events=0)}
    assert hub.health()['observedFreshCodes']==0
    hub._subscribers={}
    for i in range(MAX_CODES+1):hub._dispatch(dict(code=str(i).zfill(6)))
    assert len(hub._last_quote)==MAX_CODES
    hub._subscribers={1:SimpleNamespace(codes={'005930'},dropped_events=0)}
    hub._last_quote['005930']=time.time()-91
    health=hub.health()
    assert health['observedFreshCodes']==0
    assert health['quoteReceipts']['005930']['ageSec']>=91
    assert 'client_id' not in str(health) and 'secret' not in str(health)
