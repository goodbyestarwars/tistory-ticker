"""Latest-news window; historical reports and disclosures retain their own rules."""
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

WINDOW_SECONDS = 24 * 60 * 60
MARKET_ZONES = {'domestic': 'Asia/Seoul', 'us': 'America/New_York', 'crypto': 'UTC'}

def publication_time(value, market='domestic'):
    text = str(value or '').strip()
    if not text or re.fullmatch(r"\d{8}|\d{4}-\d{2}-\d{2}", text):
        return None
    try:
        if text.endswith(' UTC'):
            parsed = datetime.fromisoformat(text[:-4]).replace(tzinfo=timezone.utc)
        else:
            try:
                parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
            except ValueError:
                parsed = parsedate_to_datetime(text)
        if parsed.tzinfo is None:
            zone = ZoneInfo(MARKET_ZONES.get(market, 'UTC'))
            first, second = parsed.replace(tzinfo=zone, fold=0), parsed.replace(tzinfo=zone, fold=1)
            # Offset-free local time at a DST overlap/gap cannot identify a reliable instant.
            if first.utcoffset() != second.utcoffset():
                return None
            parsed = first
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None

def recent_items(items, market='domestic', now=None, keep_disclosures=False):
    # Compare instants, not local calendar days: DST must not produce 23/25-hour windows.
    current = (now or datetime.now(timezone.utc)).timestamp()
    cutoff = current - WINDOW_SECONDS
    selected = []
    for item in items or []:
        if keep_disclosures and item.get('kind') == 'disclosure':
            selected.append(item)
            continue
        published = publication_time(item.get('pubDate'), market)
        if published is None or not cutoff <= published.timestamp() <= current:
            continue
        # Explicit offset prevents visitor/VM timezone from changing interpretation.
        selected.append(dict(item, pubDate=published.astimezone(
            ZoneInfo(MARKET_ZONES.get(market, 'UTC'))).isoformat()))
    return selected
