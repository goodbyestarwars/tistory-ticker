"""Validate actual Tier1 files, dates, subjects and receipt-backed source links."""
import argparse
from datetime import datetime
import json
import re
from build_stock_stories import OUT, SELECTION, load_story, iso_day
from build_dcf_data import read_js


def validate(require_count=0):
    index = read_js(OUT / 'index.js', 'STOCK_STORIES_INDEX')
    selection = read_js(SELECTION, 'STOCK_STORY_SELECTION')
    if len(index) < require_count or len(selection.get('members', {})) < 100:
        raise ValueError('Tier1 coverage below target')
    total = 0
    for code, info in index.items():
        if not re.fullmatch(r'[0-9A-Z]{6}', code) or code not in selection['members']:
            raise ValueError('Invalid index member')
        story = load_story(code)
        if not story or story['name'] != info['name'] or not story.get('cards'):
            raise ValueError('Missing static story')
        iso_day(story['asOf'])
        for card in story['cards']:
            if not card.get('title') or not card.get('sub') or not card.get('src'):
                raise ValueError('Missing card evidence')
            iso_day(card.get('asOf'))
            if not (card.get('topic') or card.get('topics')):
                raise ValueError('Missing deduplication topic')
            if card.get('sourceUrl') and not re.fullmatch(r'https://dart\.fss\.or\.kr/dsaf001/main\.do\?rcpNo=\d{14}', card['sourceUrl']):
                raise ValueError('Unexpected source URL')
            total += 1
        encoded = json.dumps(story, allow_nan=False)
        if 'undefined' in encoded:
            raise ValueError('Undefined value')
    print('Verified Tier1: %d symbols, %d cards, whole-market ranking: %d symbols' % (len(index), total, selection['universeCount']))
    return len(index)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-count', type=int, default=0)
    validate(parser.parse_args().require_count)
