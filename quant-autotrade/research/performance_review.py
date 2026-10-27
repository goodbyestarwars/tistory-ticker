"""Offline executable-price evaluations, partitioned by mode and variant.

CLI: python performance_review.py input.json --capital 1000000
Input contains deidentified trades only; never reads an account or sends orders.
Fees/tax/slippage are explicit amounts, never assumed to be zero.
"""
import argparse
import json
import math
from collections import defaultdict

MODES = {'backtest', 'paper', 'forward', 'actual'}


def finite(value, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int,float)) or not math.isfinite(value) or (positive and value <= 0):
        raise ValueError('finite numeric evidence required')
    return float(value)


def evaluate(trade):
    if trade.get('mode') not in MODES or not trade.get('variant') or not trade.get('signalId'):
        raise ValueError('mode, variant and signalId required')
    signal, confirmed = finite(trade['signalAt']), finite(trade['confirmedAt'])
    signal_price = finite(trade['signalPrice'],positive=True)
    finite(trade['confirmedPrice'],positive=True)
    if confirmed < signal:
        raise ValueError('confirmation precedes signal')
    quote = trade.get('executableQuote')
    if quote is not None:
        if not signal <= finite(quote['availableAt']) <= confirmed:
            raise ValueError('future or pre-signal quote used for decision')
        if not 0 <= confirmed-finite(quote['at']) <= 10:
            raise ValueError('executable quote stale or future')
        finite(quote['ask'],positive=True)
        finite(quote['askSize'],positive=True)
    if trade['mode']=='actual' and quote is None:
        # Actual fills are evidence of execution; missing historical book is
        # still recorded, not backfilled from a later book.
        quote_status = 'unavailable'
    else:
        quote_status = 'observed' if quote else 'assumed'
    def fills(side):
        rows = trade.get(side, [])
        total = amount = costs = 0.
        times = []
        for row in rows:
            at = finite(row['at'])
            if at < confirmed:
                raise ValueError('fill precedes confirmation')
            qty, price = finite(row['qty'],positive=True), finite(row['price'],positive=True)
            total += qty
            amount += qty*price
            for key in ('fee','tax','slippageCost'):
                cost = finite(row[key])
                if cost < 0:
                    raise ValueError('negative cost')
                costs += cost
            times.append(at)
        return total, amount, costs, times
    bought, entry, entry_cost, buy_times = fills('buys')
    sold, proceeds, exit_cost, sell_times = fills('sells')
    submitted = trade.get('orderAt')
    if submitted is not None:
        submitted = finite(submitted)
        if submitted < confirmed or buy_times and submitted > min(buy_times):
            raise ValueError('order chronology invalid')
    if sold > bought or (buy_times and sell_times and min(sell_times)<max(buy_times)):
        raise ValueError('invalid long-position fills')
    result = {k:trade[k] for k in ('signalId','mode','variant')}
    result.update(quoteEvidence=quote_status, signalDelaySec=confirmed-signal,
                  orderAt=submitted, orderStatus=trade.get('orderStatus','unavailable'),
                  firstFillAt=min(buy_times) if buy_times else None,
                  confirmationToFillSec=min(buy_times)-confirmed if buy_times else None,
                  filledQty=bought, remainingQty=bought-sold, complete=bought>0 and sold==bought,
                  netPnl=None, maePct=None, mfePct=None, exitAt=None,
                  entrySlippagePct=(entry/bought/signal_price-1)*100 if bought else None)
    if not result['complete']:
        return result
    entry_price = entry/bought
    observed = []
    for row in trade.get('observations',[]):
        at, price = finite(row['at']), finite(row['price'],positive=True)
        if min(buy_times) <= at <= max(sell_times):
            observed.append((price/entry_price-1)*100)
    result.update(netPnl=proceeds-entry-entry_cost-exit_cost,
                  exitAt=max(sell_times),
                  maePct=min([0.]+observed) if observed else None,
                  mfePct=max([0.]+observed) if observed else None)
    return result


def summarize(trades, capital):
    capital = finite(capital,positive=True)
    groups = defaultdict(list)
    seen = set()
    for trade in trades:
        row = evaluate(trade)
        identity = (row['mode'], row['variant'], row['signalId'])
        if identity in seen:
            raise ValueError('duplicate evaluation')
        seen.add(identity)
        groups[identity[:2]].append(row)
    output = []
    for (mode,variant),rows in sorted(groups.items()):
        completed = sorted((r for r in rows if r['complete']),key=lambda r:r['exitAt'])
        pnl = [r['netPnl'] for r in completed]
        wins,losses = [v for v in pnl if v>0], [v for v in pnl if v<0]
        equity = peak = capital
        drawdown = 0.
        for value in pnl:
            equity += value
            peak = max(peak,equity)
            drawdown = max(drawdown,(peak-equity)/peak)
        output.append(dict(mode=mode,variant=variant,closedTrades=len(pnl),
            incomplete=len(rows)-len(pnl),netPnl=sum(pnl),
            expectancy=sum(pnl)/len(pnl) if pnl else None,
            winRate=len(wins)/len(pnl) if pnl else None,
            averageWin=sum(wins)/len(wins) if wins else None,
            averageLoss=sum(losses)/len(losses) if losses else None,
            profitFactor=sum(wins)/abs(sum(losses)) if losses else None,
            profitFactorStatus='finite' if losses else 'no_losses' if wins else 'no_closed_trades' if not pnl else 'flat',
            realizedMaxDrawdownPct=drawdown*100, markToMarketDrawdown=None,
            trades=rows))
    return output


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input')
    parser.add_argument('--capital',type=float,required=True)
    args=parser.parse_args()
    with open(args.input,encoding='utf8') as stream:
        data=json.load(stream)
    print(json.dumps(summarize(data,args.capital),ensure_ascii=False,allow_nan=False,indent=2))
