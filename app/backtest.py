"""Daily long-only backtests.

A signal on the close of day t is filled at that same close and earns the
move from day t to day t+1. Cash earns nothing. Costs, if any, are charged
once on entry and once on exit. This is a teaching model, not a forecast
and not a broker fill.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.errors import StudyError


@dataclass(frozen=True, slots=True)
class Bar:
    day: date
    close: float


@dataclass(frozen=True, slots=True)
class Trade:
    entry_date: date
    exit_date: date
    entry_price: float
    exit_price: float
    ret: float
    holding_days: int
    exit_reason: str


def warmup_sessions(strategy: str, params: dict) -> int:
    if strategy == "sma":
        return int(params["slow"])
    if strategy == "momentum":
        return int(params["lookback"])
    if strategy == "buyhold":
        return 0
    raise StudyError("請選擇買入並持有、均線交叉或簡單動量。")


def normalize_params(strategy: str, raw: dict | None) -> dict:
    raw = raw or {}
    if strategy == "buyhold":
        return {}
    if strategy == "sma":
        fast = _int_param(raw.get("fast", 20), "短均線")
        slow = _int_param(raw.get("slow", 50), "長均線")
        if not 2 <= fast <= 250 or not 3 <= slow <= 400 or fast >= slow:
            raise StudyError("短均線要是 2 至 250 的整數，長均線要是 3 至 400 的整數，而且短均線必須少於長均線。")
        return {"fast": fast, "slow": slow}
    if strategy == "momentum":
        lookback = _int_param(raw.get("lookback", 60), "回看日數")
        threshold_pct = _float_param(raw.get("threshold_pct", 0), "門檻")
        if not 5 <= lookback <= 504:
            raise StudyError("回看日數要是 5 至 504 的整數。")
        if not -90 <= threshold_pct <= 500:
            raise StudyError("門檻要在 −90% 至 500% 之間。")
        return {"lookback": lookback, "threshold_pct": threshold_pct}
    raise StudyError("請選擇買入並持有、均線交叉或簡單動量。")


def strategy_label(strategy: str, params: dict, cost_bps: float) -> str:
    if strategy == "buyhold":
        label = "買入並持有"
    elif strategy == "sma":
        label = f"均線交叉 {params['fast']}/{params['slow']}"
    else:
        label = f"簡單動量 {params['lookback']} 日 · 門檻 {_trim(params['threshold_pct'])}%"
    if cost_bps > 0:
        label = f"{label} · 單邊成本 {_trim(cost_bps)} 基點"
    return label


def run_backtest(
    bars: list[Bar],
    start: date,
    end: date,
    strategy: str,
    params: dict,
    cost_bps: float,
) -> dict:
    if end <= start:
        raise StudyError("開始日必須早於結束日。")
    if not 0 <= cost_bps <= 100:
        raise StudyError("單邊成本要在 0 至 100 基點之間。")

    ordered = sorted(bars, key=lambda bar: bar.day)
    if len({bar.day for bar in ordered}) != len(ordered):
        raise StudyError("價格日期有重複，無法計算。")
    if any(bar.close <= 0 for bar in ordered):
        raise StudyError("價格資料無效。")

    start_index = next((i for i, bar in enumerate(ordered) if bar.day >= start), len(ordered))
    end_index = next((i for i in range(len(ordered) - 1, -1, -1) if ordered[i].day <= end), -1)
    if start_index >= len(ordered) or end_index < 0 or end_index - start_index < 1:
        raise StudyError("這個日期範圍內沒有足夠的交易日。請拉長日期，或改用另一個代號。")

    closes = [bar.close for bar in ordered]
    dates = [bar.day for bar in ordered]
    cost = cost_bps / 10_000
    strategy_signals = _signals(closes, strategy, params)
    bench_signals = _signals(closes, "buyhold", {})

    strat_equity, strat_trades = _simulate(closes, dates, start_index, end_index, strategy_signals, cost)
    bench_equity, _bench_trades = _simulate(closes, dates, start_index, end_index, bench_signals, cost)

    actual_start = dates[start_index]
    actual_end = dates[end_index]
    notes: list[str] = []
    needed = warmup_sessions(strategy, params)
    if strategy != "buyhold" and start_index < needed:
        notes.append("區間開始時還沒有足夠日線計算指標，未就緒的日子以現金計算。")
    if ordered[0].day > start:
        notes.append(f"所選開始日早於這個代號的第一筆日線，實際由 {ordered[0].day.isoformat()} 起計。")
    if (end - actual_end).days > 6:
        notes.append(f"這個範圍內最新的日線是 {actual_end.isoformat()}。")
    if (actual_end - actual_start).days < 60:
        notes.append("區間短於 60 日，年化報酬會把短波動放大，請同時看總報酬。")

    curve = [
        {
            "date": dates[start_index + i].isoformat(),
            "strategy": strat_equity[i] * 100,
            "benchmark": bench_equity[i] * 100,
        }
        for i in range(len(strat_equity))
    ]
    return {
        "actual_start": actual_start.isoformat(),
        "actual_end": actual_end.isoformat(),
        "trading_days": end_index - start_index + 1,
        "label": strategy_label(strategy, params, cost_bps),
        "metrics": _metrics(strat_equity, actual_start, actual_end, strat_trades),
        "benchmark": _metrics(bench_equity, actual_start, actual_end, []),
        "curve": curve,
        "trades": [_trade_dict(trade) for trade in strat_trades],
        "notes": notes,
    }


def _signals(closes: list[float], strategy: str, params: dict) -> list[bool]:
    n = len(closes)
    if strategy == "buyhold":
        return [True] * n
    if strategy == "sma":
        return _sma_long(closes, params["fast"], params["slow"])
    if strategy == "momentum":
        return _momentum_long(closes, params["lookback"], params["threshold_pct"] / 100)
    raise StudyError("請選擇買入並持有、均線交叉或簡單動量。")


def _sma_long(closes: list[float], fast: int, slow: int) -> list[bool]:
    """True when the fast mean of closes up to i is above the slow mean."""
    prefix = [0.0]
    for price in closes:
        prefix.append(prefix[-1] + price)
    flags = [False] * len(closes)

    def mean(index: int, window: int) -> float:
        return (prefix[index + 1] - prefix[index + 1 - window]) / window

    for i in range(slow - 1, len(closes)):
        flags[i] = mean(i, fast) > mean(i, slow)
    return flags


def _momentum_long(closes: list[float], lookback: int, threshold: float) -> list[bool]:
    """True when the lookback-session return ending at i is above the threshold."""
    flags = [False] * len(closes)
    for i in range(lookback, len(closes)):
        base = closes[i - lookback]
        if base > 0:
            flags[i] = closes[i] / base - 1 > threshold
    return flags


def _simulate(
    closes: list[float],
    dates: list[date],
    start_index: int,
    end_index: int,
    signals: list[bool],
    cost: float,
) -> tuple[list[float], list[Trade]]:
    equity = [1.0]
    value = 1.0
    in_position = False
    entry_index: int | None = None
    trades: list[Trade] = []

    for i in range(start_index, end_index):
        want = signals[i]
        if want and not in_position:
            value *= 1 - cost
            in_position = True
            entry_index = i
        elif not want and in_position:
            value *= 1 - cost
            assert entry_index is not None
            trades.append(_make_trade(closes, dates, entry_index, i, cost, "signal"))
            in_position = False
            entry_index = None
        if closes[i] <= 0 or closes[i + 1] <= 0:
            raise StudyError("價格資料無效。")
        if in_position:
            value *= closes[i + 1] / closes[i]
        equity.append(value)

    if in_position:
        value *= 1 - cost
        equity[-1] = value
        assert entry_index is not None
        trades.append(_make_trade(closes, dates, entry_index, end_index, cost, "sample_end"))

    return equity, trades


def _make_trade(
    closes: list[float],
    dates: list[date],
    entry_index: int,
    exit_index: int,
    cost: float,
    reason: str,
) -> Trade:
    gross = closes[exit_index] / closes[entry_index]
    net = gross * (1 - cost) * (1 - cost) - 1
    return Trade(
        entry_date=dates[entry_index],
        exit_date=dates[exit_index],
        entry_price=closes[entry_index],
        exit_price=closes[exit_index],
        ret=net,
        holding_days=(dates[exit_index] - dates[entry_index]).days,
        exit_reason=reason,
    )


def _metrics(equity: list[float], start_day: date, end_day: date, trades: list[Trade]) -> dict:
    total = equity[-1] / equity[0] - 1
    span = (end_day - start_day).days
    cagr = None
    if span > 0 and equity[-1] > 0:
        cagr = equity[-1] ** (365.25 / span) - 1
    peak = equity[0]
    max_dd = 0.0
    for value in equity:
        peak = max(peak, value)
        if peak > 0:
            max_dd = min(max_dd, value / peak - 1)
    win_rate = None
    if trades:
        win_rate = sum(1 for trade in trades if trade.ret > 0) / len(trades)
    return {
        "total_return": total,
        "cagr": cagr,
        "max_drawdown": max_dd,
        "win_rate": win_rate,
        "trades": len(trades),
    }


def _trade_dict(trade: Trade) -> dict:
    return {
        "entry_date": trade.entry_date.isoformat(),
        "exit_date": trade.exit_date.isoformat(),
        "entry_price": trade.entry_price,
        "exit_price": trade.exit_price,
        "return": trade.ret,
        "holding_days": trade.holding_days,
        "exit_reason": trade.exit_reason,
    }


def _int_param(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or isinstance(value, float) and not value.is_integer():
        raise StudyError(f"{label}必須是整數。")
    return int(value)


def _float_param(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise StudyError(f"{label}必須是數字。")
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        raise StudyError(f"{label}必須是數字。")
    return number


def _trim(number: float) -> str:
    if float(number).is_integer():
        return str(int(number))
    return f"{number:g}"
