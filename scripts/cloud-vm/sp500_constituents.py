# -*- coding: utf-8 -*-
"""S&P 500 calendar membership, one server-side source of truth.

The bundled 503-symbol snapshot is the cold-start fallback (2026-09-23).
Scheduled refresh validates the public datasets/s-and-p-500-companies CSV weekly;
invalid, partial or unexpectedly large changes retain the last verified file.
Google, DART and economic-calendar events never use this membership filter.
"""

SP500_SYMBOLS = frozenset((
    'A', 'AAPL', 'ABBV', 'ABNB', 'ABT', 'ACGL', 'ACN', 'ADBE', 'ADI', 'ADM', 'ADP', 'ADSK', 'AEE',
    'AEP', 'AES', 'AFL', 'AIG', 'AIZ', 'AJG', 'AKAM', 'ALB', 'ALGN', 'ALL', 'ALLE', 'AMAT', 'AMCR',
    'AMD', 'AME', 'AMGN', 'AMP', 'AMT', 'AMZN', 'ANET', 'AON', 'AOS', 'APA', 'APD', 'APH', 'APO',
    'APP', 'APTV', 'ARE', 'ARES', 'ATO', 'AVGO', 'AVY', 'AWK', 'AXON', 'AXP', 'AZO', 'BA', 'BAC',
    'BALL', 'BAX', 'BBY', 'BDX', 'BE', 'BEN', 'BF.B', 'BG', 'BIIB', 'BKNG', 'BKR', 'BLK', 'BMY',
    'BNY', 'BR', 'BRK.B', 'BRO', 'BSX', 'BX', 'BXP', 'C', 'CAH', 'CARR', 'CASY', 'CAT', 'CB',
    'CBOE', 'CBRE', 'CCI', 'CCL', 'CDNS', 'CDW', 'CEG', 'CF', 'CFG', 'CHD', 'CHRW', 'CHTR', 'CI',
    'CIEN', 'CINF', 'CL', 'CLX', 'CMCSA', 'CME', 'CMG', 'CMI', 'CMS', 'CNC', 'CNP', 'COF', 'COHR',
    'COIN', 'COO', 'COP', 'COR', 'COST', 'CPAY', 'CPRT', 'CPT', 'CRH', 'CRL', 'CRM', 'CRWD',
    'CSCO', 'CSGP', 'CSX', 'CTAS', 'CTSH', 'CTVA', 'CVNA', 'CVS', 'CVX', 'D', 'DAL', 'DASH', 'DD',
    'DDOG', 'DE', 'DECK', 'DELL', 'DG', 'DGX', 'DHI', 'DHR', 'DIS', 'DLR', 'DLTR', 'DOC', 'DOV',
    'DOW', 'DPZ', 'DRI', 'DTE', 'DUK', 'DVA', 'DVN', 'DXCM', 'EBAY', 'ECHO', 'ECL', 'ED', 'EFX',
    'EG', 'EIX', 'EL', 'ELV', 'EME', 'EMR', 'EOG', 'EQIX', 'EQT', 'ERIE', 'ES', 'ESS', 'ETN',
    'ETR', 'EVRG', 'EW', 'EXC', 'EXE', 'EXPD', 'EXPE', 'EXR', 'F', 'FANG', 'FAST', 'FCX', 'FDS',
    'FDX', 'FDXF', 'FE', 'FERG', 'FFIV', 'FICO', 'FIS', 'FISV', 'FITB', 'FIX', 'FLEX', 'FOX',
    'FOXA', 'FRT', 'FSLR', 'FTNT', 'FTV', 'GD', 'GDDY', 'GE', 'GEHC', 'GEN', 'GEV', 'GILD', 'GIS',
    'GL', 'GLW', 'GM', 'GNRC', 'GOOG', 'GOOGL', 'GPC', 'GPN', 'GRMN', 'GS', 'GWW', 'HAL', 'HAS',
    'HBAN', 'HCA', 'HD', 'HIG', 'HII', 'HLT', 'HON', 'HONA', 'HOOD', 'HPE', 'HPQ', 'HRL', 'HSIC',
    'HST', 'HSY', 'HUBB', 'HUM', 'HWM', 'IBKR', 'IBM', 'ICE', 'IDXX', 'IEX', 'IFF', 'ILMN', 'INCY',
    'INTC', 'INTU', 'INVH', 'IP', 'IQV', 'IR', 'IRM', 'ISRG', 'IT', 'ITW', 'IVZ', 'J', 'JBHT',
    'JBL', 'JCI', 'JKHY', 'JNJ', 'JPM', 'KDP', 'KEY', 'KEYS', 'KHC', 'KIM', 'KKR', 'KLAC', 'KMB',
    'KMI', 'KO', 'KR', 'KVUE', 'L', 'LDOS', 'LEN', 'LH', 'LHX', 'LII', 'LIN', 'LITE', 'LLY', 'LMT',
    'LNT', 'LOW', 'LRCX', 'LULU', 'LUV', 'LVS', 'LYB', 'LYV', 'MA', 'MAA', 'MAR', 'MAS', 'MCD',
    'MCHP', 'MCK', 'MCO', 'MDLZ', 'MDT', 'MET', 'META', 'MGM', 'MKC', 'MLM', 'MMM', 'MNST', 'MO',
    'MOS', 'MPC', 'MPWR', 'MRK', 'MRNA', 'MRSH', 'MRVL', 'MS', 'MSCI', 'MSFT', 'MSI', 'MTB', 'MTD',
    'MU', 'NCLH', 'NDAQ', 'NDSN', 'NEE', 'NEM', 'NFLX', 'NI', 'NKE', 'NOC', 'NOW', 'NRG', 'NSC',
    'NTAP', 'NTRS', 'NUE', 'NVDA', 'NVR', 'NWS', 'NWSA', 'NXPI', 'O', 'ODFL', 'OKE', 'OMC', 'ON',
    'ORCL', 'ORLY', 'OTIS', 'OXY', 'P', 'PANW', 'PAYX', 'PCAR', 'PCG', 'PEG', 'PEP', 'PFE', 'PFG',
    'PG', 'PGR', 'PH', 'PHM', 'PKG', 'PLD', 'PLTR', 'PM', 'PNC', 'PNR', 'PNW', 'PODD', 'PPG',
    'PPL', 'PRU', 'PSA', 'PSKY', 'PSX', 'PTC', 'PWR', 'PYPL', 'Q', 'QCOM', 'RCL', 'RDDT', 'REG',
    'REGN', 'RF', 'RJF', 'RL', 'RMD', 'ROK', 'ROL', 'ROP', 'ROST', 'RSG', 'RTX', 'RVTY', 'SBAC',
    'SBUX', 'SCHW', 'SHW', 'SJM', 'SLB', 'SMCI', 'SNA', 'SNDK', 'SNPS', 'SO', 'SOLV', 'SPG',
    'SPGI', 'SRE', 'STE', 'STLD', 'STT', 'STX', 'STZ', 'SW', 'SWK', 'SWKS', 'SYF', 'SYK', 'SYY',
    'T', 'TDG', 'TDY', 'TECH', 'TEL', 'TER', 'TFC', 'TGT', 'TJX', 'TKO', 'TMO', 'TMUS', 'TPL',
    'TPR', 'TRGP', 'TRMB', 'TROW', 'TRV', 'TSCO', 'TSLA', 'TSN', 'TT', 'TTWO', 'TXN', 'TXT', 'TYL',
    'UAL', 'UBER', 'UDR', 'UHS', 'ULTA', 'UNH', 'UNP', 'UPS', 'URI', 'USB', 'V', 'VEEV', 'VICI',
    'VLO', 'VLTO', 'VMC', 'VMRK', 'VRSK', 'VRSN', 'VRT', 'VRTX', 'VST', 'VTR', 'VTRS', 'VZ', 'WAB',
    'WAT', 'WBD', 'WDAY', 'WDC', 'WEC', 'WELL', 'WFC', 'WM', 'WMB', 'WMT', 'WRB', 'WSM', 'WST',
    'WTW', 'WY', 'WYNN', 'XEL', 'XOM', 'XYL', 'XYZ', 'YUM', 'ZBH', 'ZBRA', 'ZTS',
))

# 2026-10-04 사용자 요청("캘린더는 국내주식 + S&P 100 정도만"): 미국 실적 일정을 S&P 100으로 좁힌다.
# Legacy compatibility constant; the calendar does not use this list.
SP100_SYMBOLS = frozenset((
    'AAPL ABBV ABT ACN ADBE AIG AMD AMGN AMT AMZN AVGO AXP BA BAC BK BKNG BLK BMY BRK.B C CAT CHTR '
    'CL CMCSA COF COP COST CRM CSCO CVS CVX DE DHR DIS DOW DUK EMR EXC F FDX GD GE GILD GM GOOG '
    'GOOGL GS HD HON IBM INTC JNJ JPM KHC KO LIN LLY LMT LOW MA MCD MDLZ MDT MET META MMM MO MRK '
    'MS MSFT NEE NFLX NKE NOW NVDA ORCL PEP PFE PG PM PYPL QCOM RTX SBUX SCHW SO SPG T TGT TMO TMUS '
    'TSLA TXN UNH UNP UPS USB V VZ WBA WFC WMT XOM '
    'WDC'  # 2026-10-23 사용자 지시: S&P 100 밖이지만 실적 일정에 포함(웨스턴디지털)
).split())

# Calendar membership has one owner. The old SP100 constant above is legacy only.
import csv
import io
import json
import os
import re
import time
import urllib.request
from pathlib import Path
from snapshot_io import atomic_json

CONSTITUENTS_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv'
STORE = Path(os.environ.get('SP500_STORE_FILE', str(Path(__file__).with_name('sp500_verified.json'))))
_verified = None
_retry_at = 0
_health = {'state': 'snapshot', 'verifiedAt': '2026-09-23', 'sourceUrl': CONSTITUENTS_URL}


def normalize_symbol(value):
    return str(value or '').strip().upper().replace('-', '.')


def validate(rows):
    symbols = [normalize_symbol(r.get('Symbol')) for r in rows]
    if not 490 <= len(symbols) <= 520 or len(set(symbols)) != len(symbols):
        raise ValueError('incomplete or duplicated constituent list')
    if any(not re.fullmatch(r'[A-Z]{1,6}(?:\.[A-Z])?', s) for s in symbols):
        raise ValueError('invalid constituent symbol')
    return {normalize_symbol(r['Symbol']): str(r.get('Security') or '') for r in rows}


def constituents():
    global _verified
    if _verified is None:
        try:
            payload = json.loads(STORE.read_text(encoding='utf-8'))
            _verified = validate([{'Symbol': s, 'Security': n} for s, n in payload['members'].items()])
            _health.update(state='verified', verifiedAt=payload['verifiedAt'])
        except (OSError, ValueError, KeyError, TypeError):
            _verified = {s: '' for s in SP500_SYMBOLS}
    return dict(_verified)


def refresh(now=None):
    """Weekly, scheduler-only. A failed/invalid download never replaces membership."""
    global _verified, _retry_at
    now = time.time() if now is None else now
    constituents()
    if now < _retry_at:
        return
    _retry_at = now + 3600
    try:
        if STORE.exists() and now - STORE.stat().st_mtime < 7 * 86400:
            return
        req = urllib.request.Request(CONSTITUENTS_URL, headers={'User-Agent': '9Pay-calendar/2.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = response.read(300001)
        if len(data) > 300000:
            raise ValueError('constituent download too large')
        members = validate(list(csv.DictReader(io.StringIO(data.decode('utf-8-sig')))))
        if len(set(members).symmetric_difference(_verified)) > 50:
            raise ValueError('membership change requires review')
        from calendar_model import stamp
        verified_at = stamp()
        atomic_json(STORE, {'members': members, 'verifiedAt': verified_at, 'sourceUrl': CONSTITUENTS_URL})
        _verified = members
        _health.update(state='verified', verifiedAt=verified_at, error=None)
    except Exception as exc:
        _health.update(state='stale', error=type(exc).__name__)


def health():
    constituents()
    return dict(_health, count=len(_verified))


def contains(value):
    if _verified is None:
        constituents()
    return normalize_symbol(value) in _verified
