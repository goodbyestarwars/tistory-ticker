import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'cloud-vm'))

import finnhub_realtime


class FakeClient:
    def __init__(self):
        self.events = []

    async def send_json(self, event):
        self.events.append(event)


class FinnhubRealtimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        finnhub_realtime._clients.clear()
        finnhub_realtime._baseline.clear()
        finnhub_realtime._last_price.clear()

    async def test_broadcasts_only_changed_price_with_computed_change(self):
        client = FakeClient()
        finnhub_realtime._clients[client] = {'AAPL'}
        finnhub_realtime._baseline['AAPL'] = 100.0

        await finnhub_realtime._broadcast_trade({'s': 'AAPL', 'p': 101.5, 't': 123})
        await finnhub_realtime._broadcast_trade({'s': 'AAPL', 'p': 101.5, 't': 124})

        self.assertEqual(len(client.events), 1)
        self.assertEqual(client.events[0]['code'], 'US:AAPL')
        self.assertEqual(client.events[0]['change'], 1.5)
        self.assertEqual(client.events[0]['changeRate'], 1.5)


if __name__ == '__main__':
    unittest.main()
