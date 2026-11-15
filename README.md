# 衡研

美股日線策略分析。用公開歷史價格計算買入並持有、均線交叉和簡單動量三條規則，畫出資產曲線，並列出年化報酬、總報酬、最大回撤、勝率、交易次數和交易紀錄。

這是教育工具，不是財務意見。過往結果不能預測獲利。它不連接券商，不落實盤，不使用真實資金，也不需要 API 金鑰。

Educational study of three simple US equity rules on daily prices. Not financial advice. No broker, no live orders, no real money, no API key.

## 怎樣執行

需要 Python 3.11 或以上，以及可連上 Yahoo Finance 的網絡。

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Windows 啟用虛擬環境用 `.venv\Scripts\activate`。

然後在瀏覽器打開 <http://127.0.0.1:8000>。預設例子是 SPY、近五年、20 與 50 日均線。也可以執行 `python -m app`。

## 測試

```bash
pytest
```

單元測試用合成價格，不會連上網。

## 資料來源與限制

- 日線來自 Yahoo Finance 的公開圖表接口（`query1.finance.yahoo.com`），無金鑰。這不是官方授權的資料服務，可能限流、缺日、延遲或停止。
- 只用日線收市價，優先採用調整後收市價。沒有分鐘線，也不是即時報價。
- 訊號在收市後才知道，模型假設能以該收市價成交。真實買賣有佣金、滑價和無法成交的情況。單邊成本預設是 0，所以預設結果會比真實交易樂觀。
- 只做多或持有現金，不沽空，不加槓桿，現金沒有利息。
- 美股週末和假期沒有日線。代號必須是 Yahoo 認得的，例如 SPY、AAPL、BRK.B。
- 年化報酬在很短的區間會把波動放大。頁面上的數字只描述所選歷史，不能用來推論之後可以獲利。
