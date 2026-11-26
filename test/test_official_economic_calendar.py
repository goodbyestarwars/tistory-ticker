import importlib.util
import unittest
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup

spec = importlib.util.spec_from_file_location(
    'official_economic_calendar',
    Path(__file__).resolve().parents[1] / 'scripts/build_official_economic_calendar.py',
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class OfficialCalendarTest(unittest.TestCase):
    def test_timezone_rollover_and_day_precision(self):
        for day, expected in ((date(2026, 10, 28), '2026-10-29T03:00:00+09:00'),
                              (date(2026, 12, 9), '2026-12-10T04:00:00+09:00')):
            row = mod.event('FOMC', 'FOMC', day, 'US', mod.FED, '14:00', mod.ET)
            self.assertEqual(row['start'], expected)
            self.assertEqual(row['localDate'], day.isoformat())
        jp = mod.event('BOJ', 'BOJ', date(2026, 12, 18), 'JP', mod.BOJ, kind='decision')
        self.assertEqual(jp['start'], '2026-12-18')

    def test_bad_or_duplicate_source_keeps_last_verified_schedule(self):
        row = mod.event('FOMC', 'FOMC', date(2026, 12, 9), 'US', mod.FED)
        previous = {'replace': ['FOMC'], 'events': [row]}
        current = mod.collect_group(previous, 2026, 'FOMC', ['FOMC'], lambda: [row, row])
        self.assertEqual(current['events'], [row])
        self.assertEqual(current['state'], 'error')
        self.assertEqual(current['replace'], ['FOMC'])

    def test_ecb_keeps_prior_dates_and_updates_future(self):
        events = [mod.event('ECB', 'ECB', date(2026, month, 1), 'EU', mod.ECB) for month in (1, 6, 7)]
        updated = mod.collect_group({'events': events[:2]}, 2026, 'ECB', [], lambda: events[2:], date(2026, 5, 10))
        self.assertEqual([row['start'] for row in updated['events']], ['2026-01-01', '2026-07-01'])

    def test_boj_uses_meeting_end_not_minutes_or_outlook(self):
        rows = ''.join(f'<tr><td>Jan. {d} (Thurs.), {d + 1} (Fri.)</td><td>Feb. 1</td></tr>'
                       for d in range(1, 9))
        page = BeautifulSoup(f'<table><caption>Table : 2027</caption><tbody>{rows}</tbody></table>', 'html.parser')
        events = mod.boj_annual(page, 2027)
        self.assertEqual(events[0]['start'], '2027-01-02')
        self.assertNotIn('status', events[0])


if __name__ == '__main__':
    unittest.main()
