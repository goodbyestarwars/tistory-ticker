import copy
from datetime import datetime, timedelta
import importlib.util
from pathlib import Path
import sys
import unittest
import sqlite3
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/cloud-vm'))
import signal_review as review


def bars(n=300):
    start=datetime(2025,1,1)
    days=[start+timedelta(days=i) for i in range(n*2) if (start+timedelta(days=i)).weekday()<5][:n]
    return [dict(date=d.strftime('%Y-%m-%d'),open=100+i*.1,high=102+i*.1,low=99+i*.1,
                 close=100+i*.1 + (-.15 if i%5==0 else .1),volume=100 if i%5==0 else 200) for i,d in enumerate(days)]


class SignalReviewTests(unittest.TestCase):
    def setUp(self):
        self.rows=bars()
        self.now=datetime.fromisoformat(self.rows[-1]['date']).replace(hour=16,tzinfo=review.KST)
        self.detail=dict(status='BREAKOUT_CONFIRMED',support=self.rows[-1]['close']*.98,
                         resistance=self.rows[-1]['close']*.99,financialScreen={'passed':True})

    def test_swing_confirmed_without_waiting_and_no_order_permission(self):
        result=review.daily_review(self.rows,self.detail,as_of=self.now,benchmark=self.rows)
        self.assertTrue(result['confirmed'],result)
        self.assertFalse(result['entryValid'])
        self.assertFalse(result['orderAuthorized'])
        self.assertEqual(result['mode'],'shadow')

    def test_missing_benchmark_never_passes(self):
        result=review.daily_review(self.rows,self.detail,as_of=self.now)
        self.assertFalse(result['confirmed'])
        self.assertIn('relativeStrength',result['reasons'])

    def test_unfinished_daily_future_duplicate_and_bad_ohlc(self):
        for rows,now in [(self.rows,self.now.replace(hour=10)),(self.rows,self.now-timedelta(days=1)),
                         (self.rows+[self.rows[-1]],self.now),
                         (self.rows[:-1]+[dict(self.rows[-1],volume=float('nan'))],self.now)]:
            self.assertFalse(review.daily_review(rows,self.detail,as_of=now,benchmark=rows)['confirmed'])

    def test_candidate_and_invalidated_support_not_confirmed(self):
        for change in ({'status':'COMPRESSION_READY'},{'support':10000},{'resistance':10}):
            result=review.daily_review(self.rows,dict(self.detail,**change),as_of=self.now,benchmark=self.rows)
            self.assertFalse(result['confirmed'])

    def test_long_confirmed_closed_week_month_and_financials(self):
        result=review.daily_review(self.rows,self.detail,as_of=self.now,benchmark=self.rows,strategy='long')
        self.assertTrue(result['confirmed'],result)
        changed=dict(self.detail,financialScreen={'passed':False})
        self.assertFalse(review.daily_review(self.rows,changed,as_of=self.now,benchmark=self.rows,strategy='long')['confirmed'])

    def test_current_week_and_month_not_complete(self):
        now=datetime(2026,10,28,16,tzinfo=review.KST)
        rows=[dict(date='2026-10-23',close=100),dict(date='2026-10-28',close=10000)]
        self.assertEqual(review._period_closes(rows,now,True),[100])
        self.assertEqual(review._period_closes(rows,now,False),[])
        month_end=datetime(2026,10,30,16,tzinfo=review.KST)
        self.assertEqual(review._period_closes([dict(date='2026-10-30',close=100)],month_end,False),[100])
        holiday_end=datetime(2026,12,24,16,tzinfo=review.KST)
        self.assertEqual(review._period_closes([dict(date='2026-12-24',close=100)],holiday_end,True),[100])

    def test_evidence_survives_restart_without_duplicate_or_later_bars(self):
        import db_schema
        item=dict(code='005930',date=self.rows[-1]['date'],patternDetail=self.detail)
        groups={'pullback':[item]}
        conn=sqlite3.connect(':memory:')
        self.addCleanup(conn.close)
        benchmark=[dict(date=r['date'],close=r['close']) for r in self.rows]
        with patch.object(db_schema,'load_daily_prices',return_value=self.rows), patch.object(db_schema,'load_future_chart_since',return_value=benchmark):
            review.review_groups(conn,groups,self.now)
            first=copy.deepcopy(item['signalReview'])
            review.review_groups(conn,groups,self.now+timedelta(days=1))
        self.assertEqual(first,item['signalReview'])
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM signal_reviews').fetchone()[0],1)
        self.assertFalse(item['signalReview']['orderAuthorized'])

    def test_intraday_missing_microstructure_blocks_first_stage(self):
        now=datetime(2026,10,28,10,tzinfo=review.KST).timestamp()
        item=dict(at=now,sampleAt=now,price=100,pullbackLow=98,first70At=now-30,
                  volumeRatio=.8,volumeMissing=False,entryInvalid=False,excluded=None,
                  ruleVersion='ab70-v1',source='Kiwoom WebSocket')
        state=dict(running=True,active=True,rankAt=datetime.fromtimestamp(now,review.KST).isoformat())
        result=review.intraday_review(item,state,now)
        self.assertFalse(result['confirmed'])
        self.assertEqual(result['reasons'],['liquidity','flow'])
        item.update(liquidityVerified=True,buyFlowVerified=True)
        self.assertTrue(review.intraday_review(item,state,now)['confirmed'])
        for change in ({'sampleAt':now-11},{'entryInvalid':True},{'source':'Toss WebSocket'},{'volumeMissing':True}):
            self.assertFalse(review.intraday_review(dict(item,**change),state,now)['confirmed'])
        self.assertFalse(review.intraday_review(item,dict(state,queueDropped=1),now)['confirmed'])


spec=importlib.util.spec_from_file_location('performance_review',ROOT/'quant-autotrade/research/performance_review.py')
perf=importlib.util.module_from_spec(spec)
spec.loader.exec_module(perf)


class PerformanceTests(unittest.TestCase):
    def trade(self):
        return dict(signalId='synthetic',mode='paper',variant='first',signalAt=100,confirmedAt=102,
                    signalPrice=100,confirmedPrice=101,
                    executableQuote=dict(at=101,availableAt=102,ask=101,askSize=10),
                    buys=[dict(at=103,qty=2,price=101,fee=1,tax=0,slippageCost=0)],
                    sells=[dict(at=120,qty=2,price=105,fee=1,tax=1,slippageCost=0)],
                    observations=[dict(at=104,price=99),dict(at=110,price=106)])

    def test_costs_and_excursions(self):
        result=perf.evaluate(self.trade())
        self.assertEqual(result['netPnl'],5)
        self.assertLess(result['maePct'],0)
        self.assertGreater(result['mfePct'],0)

    def test_partial_unfilled_and_failure_excluded_from_closed_stats(self):
        for sells in ([],[dict(at=120,qty=1,price=105,fee=0,tax=0,slippageCost=0)]):
            trade=self.trade();trade['sells']=sells
            result=perf.summarize([trade],1000)[0]
            self.assertEqual(result['closedTrades'],0)
            self.assertEqual(result['incomplete'],1)
            self.assertIsNone(result['expectancy'])

    def test_partition_modes_variants_and_duplicates(self):
        a=self.trade();b=dict(a,mode='actual');c=dict(a,variant='second')
        self.assertEqual(len(perf.summarize([a,b,c],1000)),3)
        with self.assertRaises(ValueError):perf.summarize([a,a],1000)

    def test_future_quote_missing_cost_and_invalid_fill_rejected(self):
        for key,value in [('executableQuote',dict(at=103,availableAt=103,ask=101,askSize=10)),
                          ('buys',[dict(at=101,qty=1,price=100,fee=0,tax=0,slippageCost=0)]),
                          ('sells',[dict(at=120,qty=2,price=105)])]:
            with self.assertRaises((ValueError,KeyError)):perf.evaluate(dict(self.trade(),**{key:value}))


if __name__=='__main__':unittest.main()
