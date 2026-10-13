# -*- coding: utf-8 -*-
"""Proposed single-account policy for simulation only. No broker or order imports."""

BUDGET_WON = 1_000_000
MAX_POSITIONS = 3
MAX_PER_POSITION_WON = 300_000
RESERVE_WON = 100_000
ROUND_TRIP_COST = 0.004
EXIT_SLIPPAGE = 0.003
STOP_NET = -0.05
PROFIT_FLOOR_NET = 0.03
PROFIT_CAP_NET = 0.06


def entry_won(cash_won, invested_won, held_codes, code, pending_codes=()):
    """Return allowed cash amount. Pending buys and held shares block duplicates."""
    if code in set(held_codes) | set(pending_codes):
        return 0, 'DUP'
    if len(set(held_codes) | set(pending_codes)) >= MAX_POSITIONS:
        return 0, 'MAX_POS'
    amount = max(0, min(MAX_PER_POSITION_WON, BUDGET_WON - RESERVE_WON - invested_won,
                        cash_won - RESERVE_WON))
    return (amount, None) if amount > 0 else (0, 'RESERVE_OR_CAP')


def rank_candidates(candidates):
    """Require comparable numeric data; highest trading value, liquidity, volatility fit, trend first."""
    fields = ('trading_value', 'liquidity', 'volatility_fit', 'trend')
    eligible = [c for c in candidates if all(isinstance(c.get(k), (int, float)) and c[k] >= 0 for k in fields)]
    return sorted(eligible, key=lambda c: tuple([-c[k] for k in fields] + [str(c['code'])]))


def net_return(entry, exit_price, cost=ROUND_TRIP_COST + EXIT_SLIPPAGE):
    return exit_price / entry - 1 - cost


def simulated_exit(entry, price, peak_net, cost=ROUND_TRIP_COST + EXIT_SLIPPAGE):
    """Simulation-only assumption: stop at net -5%, cap at net +6%, floor on pullback below +3%."""
    if entry <= 0 or price <= 0:
        return None
    net = net_return(entry, price, cost)
    if net <= STOP_NET:
        return 'NET_STOP'
    if net >= PROFIT_CAP_NET:
        return 'SIM_TP_CAP'
    if peak_net is not None and peak_net >= PROFIT_FLOOR_NET and net < PROFIT_FLOOR_NET:
        return 'SIM_TP_TRAIL'
    return None
