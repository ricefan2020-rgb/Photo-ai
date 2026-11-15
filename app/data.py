"""Daily bars from Yahoo Finance's public chart endpoint.

No API key. The feed is unofficial: it can throttle, skip a session, or change
without notice. Adjusted close is preferred so splits and dividends do not
show up as fake crashes.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx

from app.backtest import Bar
from app.errors import StudyError

NY = ZoneInfo("America/New_York")
CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
HEADERS = {
    "User-Agent": "HengYan/1.0 (educational backtest; local study tool)",
    "Accept": "application/json",
}
_CACHE: OrderedDict[tuple, tuple[float, "History"]] = OrderedDict()
_LOCK = threading.Lock()
_TTL_SECONDS = 15 * 60
_CACHE_LIMIT = 24


@dataclass(frozen=True, slots=True)
class History:
    symbol: str
    name: str
    currency: str
    instrument_type: str | None
    adjusted: bool
    bars: list[Bar]


def normalize_symbol(raw: str) -> str:
    symbol = "".join(raw.split()).upper()
    if not symbol:
        raise StudyError("請輸入代號。")
    # Share classes such as BRK.B are written BRK-B on Yahoo.
    parts = symbol.split(".")
    if len(parts) == 2 and parts[0].isalpha() and len(parts[0]) <= 5 and len(parts[1]) == 1 and parts[1].isalpha():
        symbol = f"{parts[0]}-{parts[1]}"
    if not _valid_symbol(symbol):
        raise StudyError("請輸入有效的美股代號，例如 SPY、AAPL 或 BRK.B。")
    return symbol


def fetch_history(symbol: str, start: date, end: date, pad_sessions: int) -> History:
    symbol = normalize_symbol(symbol)
    pad_days = int(pad_sessions * 7 / 5) + 30
    period1 = _unix(start - timedelta(days=pad_days))
    # period2 is exclusive on this feed, and the end date may fall on a weekend.
    period2 = _unix(end + timedelta(days=5))
    key = (symbol, period1, period2)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    url = CHART_URL.format(symbol=quote(symbol, safe=""))
    payload = _get_json(url, {"period1": period1, "period2": period2, "interval": "1d", "includeAdjustedClose": "true", "events": "div,splits"})
    history = parse_chart(payload, fallback_symbol=symbol)
    history = History(
        symbol=history.symbol,
        name=history.name,
        currency=history.currency,
        instrument_type=history.instrument_type,
        adjusted=history.adjusted,
        bars=[bar for bar in history.bars if bar.day <= end],
    )
    if not history.bars:
        raise StudyError("這個日期範圍內沒有日線價格。", 404)
    _cache_put(key, history)
    return history


def parse_chart(payload: dict, fallback_symbol: str = "") -> History:
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise StudyError("找不到這個代號的日線價格。請檢查代號，例如 SPY、AAPL、QQQ。", 404)
    result = chart.get("result") or []
    if not result:
        raise StudyError("找不到這個代號的日線價格。請檢查代號，例如 SPY、AAPL、QQQ。", 404)

    block = result[0]
    meta = block.get("meta") or {}
    timestamps = block.get("timestamp") or []
    indicators = block.get("indicators") or {}
    quote = (indicators.get("quote") or [{}])[0]
    raw_close = quote.get("close") or []
    adj_block = (indicators.get("adjclose") or [{}])[0]
    adj = adj_block.get("adjclose")
    use_adj = isinstance(adj, list) and any(isinstance(value, (int, float)) and value > 0 for value in adj)
    prices = adj if use_adj else raw_close

    by_day: dict[date, float] = {}
    for index, ts in enumerate(timestamps):
        if not isinstance(ts, (int, float)) or index >= len(prices):
            continue
        value = prices[index]
        if not isinstance(value, (int, float)) or value <= 0:
            continue
        day = datetime.fromtimestamp(int(ts), NY).date()
        by_day[day] = float(value)

    if not by_day:
        raise StudyError("找不到這個代號的日線價格。請檢查代號，例如 SPY、AAPL、QQQ。", 404)

    symbol = str(meta.get("symbol") or fallback_symbol)
    name = str(meta.get("longName") or meta.get("shortName") or symbol)
    currency = str(meta.get("currency") or "USD")
    instrument = meta.get("instrumentType")
    bars = [Bar(day, price) for day, price in sorted(by_day.items())]
    return History(
        symbol=symbol,
        name=name,
        currency=currency,
        instrument_type=str(instrument) if instrument else None,
        adjusted=use_adj,
        bars=bars,
    )


def _get_json(url: str, params: dict) -> dict:
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            with httpx.Client(timeout=20.0, headers=HEADERS, follow_redirects=True) as client:
                response = client.get(url, params=params)
        except httpx.TimeoutException as exc:
            last_error = exc
            if attempt == 0:
                continue
            raise StudyError("讀取價格逾時，請稍後再試。", 504) from exc
        except httpx.HTTPError as exc:
            last_error = exc
            if attempt == 0:
                continue
            raise StudyError("暫時連不上價格來源，請稍後再試。", 502) from exc

        if response.status_code == 404:
            raise StudyError("找不到這個代號的日線價格。請檢查代號，例如 SPY、AAPL、QQQ。", 404)
        if response.status_code == 429:
            raise StudyError("資料來源暫時忙碌，請稍後再試。", 429)
        if response.status_code in {500, 502, 503, 504} and attempt == 0:
            continue
        if response.status_code != 200:
            raise StudyError("暫時取不到價格，請稍後再試。", 502)
        try:
            return response.json()
        except ValueError as exc:
            last_error = exc
            if attempt == 0:
                continue
            raise StudyError("價格來源回傳了無法讀取的內容。", 502) from exc
    raise StudyError("暫時取不到價格，請稍後再試。", 502) from last_error


def _unix(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=NY).timestamp())


def _valid_symbol(symbol: str) -> bool:
    if not 1 <= len(symbol) <= 15:
        return False
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-")
    return all(char in allowed for char in symbol) and symbol[0].isalnum() and symbol[-1].isalnum()


def _cache_get(key: tuple) -> History | None:
    now = time.monotonic()
    with _LOCK:
        item = _CACHE.get(key)
        if item is None:
            return None
        stored_at, history = item
        if now - stored_at > _TTL_SECONDS:
            _CACHE.pop(key, None)
            return None
        _CACHE.move_to_end(key)
        return history


def _cache_put(key: tuple, history: History) -> None:
    with _LOCK:
        _CACHE[key] = (time.monotonic(), history)
        _CACHE.move_to_end(key)
        while len(_CACHE) > _CACHE_LIMIT:
            _CACHE.popitem(last=False)
