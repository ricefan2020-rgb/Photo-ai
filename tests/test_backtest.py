from datetime import date, timedelta

import pytest

from app.backtest import Bar, normalize_params, run_backtest
from app.errors import StudyError


def bars_from(prices, start=date(2024, 1, 1)):
    return [Bar(start + timedelta(days=i), float(price)) for i, price in enumerate(prices)]


def test_buyhold_return_drawdown_and_single_trade():
    result = run_backtest(bars_from([100, 150, 125]), date(2024, 1, 1), date(2024, 1, 3), "buyhold", {}, 0)
    assert result["metrics"]["total_return"] == pytest.approx(0.25)
    assert result["metrics"]["max_drawdown"] == pytest.approx(125 / 150 - 1)
    assert result["metrics"]["trades"] == 1
    assert result["metrics"]["win_rate"] == 1
    assert result["trades"][0]["exit_reason"] == "sample_end"
    assert result["curve"][0]["strategy"] == pytest.approx(100)
    assert result["curve"][-1]["strategy"] == pytest.approx(125)


def test_buyhold_cost_is_charged_on_entry_and_exit():
    result = run_backtest(bars_from([100, 100]), date(2024, 1, 1), date(2024, 1, 2), "buyhold", {}, 100)
    assert result["metrics"]["total_return"] == pytest.approx(0.99 * 0.99 - 1)


def test_sma_cross_exits_before_the_next_drop():
    # fast 2 / slow 4. Long only while the fast mean is strictly above the slow mean.
    prices = [10, 10, 10, 10, 10, 20, 20, 20, 5, 5]
    result = run_backtest(bars_from(prices), date(2024, 1, 1), date(2024, 1, 10), "sma", {"fast": 2, "slow": 4}, 0)
    assert result["metrics"]["trades"] == 1
    trade = result["trades"][0]
    assert trade["entry_price"] == 20
    assert trade["exit_price"] == 5
    assert trade["return"] == pytest.approx(-0.75)
    assert trade["exit_reason"] == "signal"
    assert result["metrics"]["total_return"] == pytest.approx(-0.75)
    assert result["metrics"]["win_rate"] == 0


def test_momentum_leaves_before_a_later_crash():
    prices = [10, 10, 10, 10, 12, 9, 1]
    result = run_backtest(
        bars_from(prices),
        date(2024, 1, 1),
        date(2024, 1, 7),
        "momentum",
        {"lookback": 3, "threshold_pct": 0},
        0,
    )
    assert result["trades"][0]["exit_price"] == 9
    assert result["metrics"]["total_return"] == pytest.approx(-0.25)
    assert result["curve"][-1]["strategy"] == pytest.approx(75)


def test_flat_market_sma_holds_cash():
    result = run_backtest(bars_from([10, 10, 10, 10, 10, 10]), date(2024, 1, 1), date(2024, 1, 6), "sma", {"fast": 2, "slow": 4}, 0)
    assert result["metrics"]["trades"] == 0
    assert result["metrics"]["total_return"] == 0
    assert result["metrics"]["win_rate"] is None
    assert result["metrics"]["max_drawdown"] == 0


def test_trade_returns_compound_to_the_equity_curve():
    prices = [100, 102, 101, 105, 103, 110, 108, 115, 112, 120, 118, 125, 123, 130, 128, 140, 133, 150]
    result = run_backtest(
        bars_from(prices),
        date(2024, 1, 1),
        date(2024, 1, 18),
        "sma",
        {"fast": 3, "slow": 5},
        5,
    )
    assert result["trades"]
    compounded = 1.0
    for trade in result["trades"]:
        compounded *= 1 + trade["return"]
    assert compounded - 1 == pytest.approx(result["metrics"]["total_return"])
    hold = run_backtest(bars_from(prices), date(2024, 1, 1), date(2024, 1, 18), "buyhold", {}, 5)
    assert result["benchmark"]["total_return"] == pytest.approx(hold["metrics"]["total_return"])


def test_older_bars_outside_the_lookback_do_not_change_the_window():
    prices = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]
    start = date(2024, 1, 5)
    end = date(2024, 1, 12)
    full = run_backtest(bars_from(prices), start, end, "momentum", {"lookback": 3, "threshold_pct": 0}, 0)
    older = [Bar(date(2023, 12, 30), 50), Bar(date(2023, 12, 31), 40), *bars_from(prices)]
    with_older = run_backtest(older, start, end, "momentum", {"lookback": 3, "threshold_pct": 0}, 0)
    assert with_older["metrics"]["total_return"] == pytest.approx(full["metrics"]["total_return"])
    assert [point["strategy"] for point in with_older["curve"]] == pytest.approx(
        [point["strategy"] for point in full["curve"]]
    )


def test_future_price_does_not_change_earlier_signals():
    from app.backtest import _momentum_long, _sma_long

    closes = [10, 11, 12, 13, 14, 15, 16, 17]
    assert _sma_long(closes, 2, 4) == _sma_long(closes + [1000], 2, 4)[: len(closes)]
    assert _momentum_long(closes, 3, 0) == _momentum_long(closes + [1], 3, 0)[: len(closes)]


def test_cagr_uses_calendar_span():
    result = run_backtest(
        [Bar(date(2021, 1, 1), 100), Bar(date(2022, 1, 1), 110)],
        date(2021, 1, 1),
        date(2022, 1, 1),
        "buyhold",
        {},
        0,
    )
    span = (date(2022, 1, 1) - date(2021, 1, 1)).days
    assert result["metrics"]["cagr"] == pytest.approx(1.1 ** (365.25 / span) - 1)


def test_rejects_bad_windows_and_params():
    with pytest.raises(StudyError):
        run_backtest(bars_from([100]), date(2024, 1, 1), date(2024, 1, 1), "buyhold", {}, 0)
    with pytest.raises(StudyError):
        normalize_params("sma", {"fast": 50, "slow": 20})
    with pytest.raises(StudyError):
        normalize_params("momentum", {"lookback": 2, "threshold_pct": 0})
