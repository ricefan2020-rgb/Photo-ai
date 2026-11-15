from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.backtest import Bar
from app.data import History
from app.main import app

client = TestClient(app)


def sample_history(symbol="SPY"):
    start = date(2024, 1, 2)
    prices = [100, 110, 105, 120, 115, 130]
    bars = [Bar(start + timedelta(days=i), float(price)) for i, price in enumerate(prices)]
    return History(symbol, "SPDR S&P 500 ETF Trust", "USD", "ETF", True, bars)


def test_home_is_traditional_chinese_and_states_the_disclaimer():
    response = client.get("/")
    assert response.status_code == 200
    text = response.text
    assert 'lang="zh-Hant-HK"' in text
    assert "本頁只供教育分析，並非財務意見。過往結果不能預測獲利。" in text
    assert "買入並持有" in text
    assert "均線交叉" in text
    assert "簡單動量" in text


def test_backtest_endpoint(monkeypatch):
    seen = {}

    def fake_fetch(symbol, start, end, pad_sessions):
        seen["symbol"] = symbol
        seen["pad"] = pad_sessions
        return sample_history(symbol)

    monkeypatch.setattr("app.main.fetch_history", fake_fetch)
    response = client.post(
        "/api/backtest",
        json={
            "symbol": " spy ",
            "start": "2024-01-02",
            "end": "2024-01-07",
            "strategy": "buyhold",
            "cost_bps": 0,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert seen["symbol"] == "SPY"
    assert body["symbol"] == "SPY"
    assert body["price_basis"] == "調整後收市價"
    assert body["metrics"]["trades"] == 1
    assert body["metrics"]["total_return"] == pytest_approx(130 / 100 - 1)
    assert body["curve"][0]["strategy"] == 100
    assert "不能預測" not in body["name"]


def test_rejects_bad_input_without_calling_the_feed(monkeypatch):
    def fail_fetch(*_args, **_kwargs):
        raise AssertionError("should not fetch")

    monkeypatch.setattr("app.main.fetch_history", fail_fetch)
    bad_symbol = client.post(
        "/api/backtest",
        json={"symbol": "../etc", "start": "2024-01-01", "end": "2024-06-01", "strategy": "buyhold"},
    )
    assert bad_symbol.status_code == 400
    assert "代號" in bad_symbol.json()["error"]

    bad_params = client.post(
        "/api/backtest",
        json={
            "symbol": "SPY",
            "start": "2024-01-01",
            "end": "2024-06-01",
            "strategy": "sma",
            "fast": 50,
            "slow": 20,
        },
    )
    assert bad_params.status_code == 400


def pytest_approx(value):
    import pytest

    return pytest.approx(value)
