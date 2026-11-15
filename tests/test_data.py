from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app.data import normalize_symbol, parse_chart
from app.errors import StudyError

NY = ZoneInfo("America/New_York")


def test_normalize_symbol():
    assert normalize_symbol(" spy ") == "SPY"
    assert normalize_symbol("brk.b") == "BRK-B"
    assert normalize_symbol("BRK-B") == "BRK-B"
    with pytest.raises(StudyError):
        normalize_symbol("")
    with pytest.raises(StudyError):
        normalize_symbol("../etc")


def test_parse_chart_uses_adjusted_close_and_new_york_dates():
    ts = int(datetime(2024, 6, 3, 16, 0, tzinfo=NY).timestamp())
    payload = {
        "chart": {
            "result": [
                {
                    "meta": {
                        "symbol": "SPY",
                        "longName": "SPDR S&P 500 ETF Trust",
                        "currency": "USD",
                        "instrumentType": "ETF",
                    },
                    "timestamp": [ts, ts + 86400],
                    "indicators": {
                        "quote": [{"close": [100.0, 110.0]}],
                        "adjclose": [{"adjclose": [99.5, None]}],
                    },
                }
            ],
            "error": None,
        }
    }
    history = parse_chart(payload)
    assert history.adjusted is True
    assert history.name == "SPDR S&P 500 ETF Trust"
    assert len(history.bars) == 1
    assert history.bars[0].day.isoformat() == "2024-06-03"
    assert history.bars[0].close == pytest.approx(99.5)


def test_parse_chart_falls_back_when_adjustment_is_missing():
    ts = int(datetime(2024, 6, 3, 16, 0, tzinfo=NY).timestamp())
    payload = {
        "chart": {
            "result": [
                {
                    "meta": {"symbol": "XYZ", "currency": "USD"},
                    "timestamp": [ts],
                    "indicators": {"quote": [{"close": [12.5]}]},
                }
            ]
        }
    }
    history = parse_chart(payload)
    assert history.adjusted is False
    assert history.bars[0].close == pytest.approx(12.5)


def test_parse_chart_reports_unknown_symbols():
    with pytest.raises(StudyError):
        parse_chart({"chart": {"result": None, "error": {"description": "No data found"}}})
