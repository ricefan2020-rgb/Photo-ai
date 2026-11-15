from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.backtest import normalize_params, run_backtest, warmup_sessions
from app.data import fetch_history, normalize_symbol
from app.errors import StudyError

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
NY = ZoneInfo("America/New_York")

TYPE_LABELS = {
    "ETF": "交易所買賣基金",
    "EQUITY": "股票",
    "MUTUALFUND": "基金",
    "INDEX": "指數",
}

app = FastAPI(title="衡研", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


class BacktestIn(BaseModel):
    symbol: str
    start: date
    end: date
    strategy: str
    fast: int | None = None
    slow: int | None = None
    lookback: int | None = None
    threshold_pct: float | None = None
    cost_bps: float = Field(default=0)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.post("/api/backtest")
def backtest(body: BacktestIn) -> dict:
    today = datetime.now(NY).date()
    if body.end > today or body.start > today:
        raise StudyError(f"日期不能晚於美國市場的今天（{today.isoformat()}）。")
    if body.start < date(1970, 1, 2):
        raise StudyError("開始日太早。")
    if (body.end - body.start).days > 365 * 45:
        raise StudyError("日期範圍最長約 45 年。")

    symbol = normalize_symbol(body.symbol)
    raw = {
        "fast": body.fast,
        "slow": body.slow,
        "lookback": body.lookback,
        "threshold_pct": body.threshold_pct,
    }
    params = normalize_params(body.strategy, {key: value for key, value in raw.items() if value is not None})
    history = fetch_history(symbol, body.start, body.end, warmup_sessions(body.strategy, params))
    result = run_backtest(history.bars, body.start, body.end, body.strategy, params, body.cost_bps)

    currency = "美元" if history.currency == "USD" else history.currency
    basis = "調整後收市價" if history.adjusted else "未調整收市價"
    kind = TYPE_LABELS.get(history.instrument_type or "", "")
    if not history.adjusted:
        result["notes"] = [
            "這個代號沒有調整後收市價，改用未調整收市價。拆股或股息可能會扭曲曲線。",
            *result["notes"],
        ]
    return {
        "symbol": history.symbol,
        "name": history.name,
        "currency_label": currency,
        "instrument_label": kind,
        "price_basis": basis,
        "strategy": body.strategy,
        **result,
    }


@app.exception_handler(StudyError)
async def study_error(_request, exc: StudyError) -> JSONResponse:
    return JSONResponse({"error": exc.message}, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def bad_request(_request, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse({"error": "請求格式不正確。請檢查代號、日期和策略。"}, status_code=400)


def main() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
