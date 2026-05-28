"""Minimal AkShare HTTP service for the Expo app.

Run:
  python3.11 scripts/akshare_server.py
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

import akshare as ak


HOST = os.environ.get("AKSHARE_HOST", "0.0.0.0")
PORT = int(os.environ.get("AKSHARE_PORT", "8765"))
RANGE_DAYS = {
    "近7日": 7,
    "近一个月": 31,
    "近1年": 366,
}


def _safe_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if math.isnan(number) or math.isinf(number):
        return None

    return number


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _search_stocks(keyword: str, limit: int) -> list[dict[str, Any]]:
    stock_df = ak.stock_info_a_code_name()
    keyword_lower = keyword.lower()
    results: list[dict[str, Any]] = []

    for row in stock_df.to_dict("records"):
        code = str(row.get("code", ""))
        name = str(row.get("name", ""))

        if keyword and keyword_lower not in code.lower() and keyword_lower not in name.lower():
            continue

        results.append(
            {
                "code": code,
                "name": name,
                "type": "股票",
                "price": None,
                "changeRate": None,
            }
        )

        if len(results) >= limit:
            break

    return results


def _search_funds(keyword: str, limit: int) -> list[dict[str, Any]]:
    fund_df = ak.fund_name_em()
    keyword_lower = keyword.lower()
    results: list[dict[str, Any]] = []

    for row in fund_df.to_dict("records"):
        code = str(row.get("基金代码", ""))
        name = str(row.get("基金简称", ""))
        fund_type = str(row.get("基金类型", "基金"))

        if keyword and keyword_lower not in code.lower() and keyword_lower not in name.lower() and keyword_lower not in fund_type.lower():
            continue

        results.append(
            {
                "code": code,
                "name": name,
                "type": "基金",
                "price": None,
                "changeRate": None,
            }
        )

        if len(results) >= limit:
            break

    return results


def search_securities(keyword: str, limit: int) -> list[dict[str, Any]]:
    stock_limit = max(1, limit // 2)
    fund_limit = max(1, limit - stock_limit)
    return (_search_stocks(keyword, stock_limit) + _search_funds(keyword, fund_limit))[:limit]


def _normalize_candles(records: list[dict[str, Any]], column_map: dict[str, str]) -> list[dict[str, Any]]:
    candles: list[dict[str, Any]] = []

    for row in records:
        volume_key = column_map.get("volume")
        amount_key = column_map.get("amount")
        amplitude_key = column_map.get("amplitude")
        change_rate_key = column_map.get("changeRate")
        change_amount_key = column_map.get("changeAmount")
        turnover_rate_key = column_map.get("turnoverRate")
        candle = {
            "date": str(row.get(column_map["date"], "")),
            "open": _safe_number(row.get(column_map["open"])),
            "high": _safe_number(row.get(column_map["high"])),
            "low": _safe_number(row.get(column_map["low"])),
            "close": _safe_number(row.get(column_map["close"])),
            "volume": _safe_number(row.get(volume_key)) if volume_key else None,
            "amount": _safe_number(row.get(amount_key)) if amount_key else None,
            "amplitude": _safe_number(row.get(amplitude_key)) if amplitude_key else None,
            "changeRate": _safe_number(row.get(change_rate_key)) if change_rate_key else None,
            "changeAmount": _safe_number(row.get(change_amount_key)) if change_amount_key else None,
            "turnoverRate": _safe_number(row.get(turnover_rate_key)) if turnover_rate_key else None,
        }

        if all(candle[key] is not None for key in ("open", "high", "low", "close")):
            open_price = float(candle["open"])
            close_price = float(candle["close"])
            high_price = float(candle["high"])
            low_price = float(candle["low"])

            if candle["changeAmount"] is None:
                candle["changeAmount"] = close_price - open_price

            if candle["changeRate"] is None:
                candle["changeRate"] = ((close_price - open_price) / open_price * 100) if open_price else 0

            if candle["amplitude"] is None:
                candle["amplitude"] = ((high_price - low_price) / open_price * 100) if open_price else 0

            candles.append(candle)

    return candles


def _trend_response(candles: list[dict[str, Any]]) -> dict[str, Any]:
    if not candles:
        raise ValueError("行情数据为空")

    trend = [float(candle["close"]) for candle in candles]
    first_price = trend[0]
    latest_price = trend[-1]
    change_rate = ((latest_price - first_price) / first_price * 100) if first_price else 0

    return {
        "price": latest_price,
        "changeRate": change_rate,
        "trend": trend,
        "candles": candles,
    }


def _daily_symbol(symbol: str) -> str:
    if symbol.startswith("6"):
        return f"sh{symbol}"

    if symbol.startswith(("8", "4", "9")):
        return f"bj{symbol}"

    return f"sz{symbol}"


def _stock_trend(symbol: str, range_label: str) -> dict[str, Any]:
    end_date = datetime.now()
    start_date = end_date - timedelta(days=RANGE_DAYS.get(range_label, 31))

    try:
        hist_df = ak.stock_zh_a_hist(
            symbol=symbol,
            period="daily",
            start_date=start_date.strftime("%Y%m%d"),
            end_date=end_date.strftime("%Y%m%d"),
            adjust="qfq",
        )
        candles = _normalize_candles(
            hist_df.to_dict("records"),
            {
                "date": "日期",
                "open": "开盘",
                "high": "最高",
                "low": "最低",
                "close": "收盘",
                "volume": "成交量",
                "amount": "成交额",
                "amplitude": "振幅",
                "changeRate": "涨跌幅",
                "changeAmount": "涨跌额",
                "turnoverRate": "换手率",
            },
        )
    except Exception:
        hist_df = ak.stock_zh_a_daily(symbol=_daily_symbol(symbol))
        hist_df = hist_df[hist_df["date"] >= start_date.date()]
        candles = _normalize_candles(
            hist_df.to_dict("records"),
            {
                "date": "date",
                "open": "open",
                "high": "high",
                "low": "low",
                "close": "close",
                "volume": "volume",
            },
        )

    return _trend_response(candles)


def _fund_trend(symbol: str, range_label: str) -> dict[str, Any]:
    trend_df = ak.fund_open_fund_info_em(symbol=symbol, indicator="单位净值走势")
    days = RANGE_DAYS.get(range_label, 31)
    recent_df = trend_df.tail(days)

    if recent_df.empty:
        raise ValueError("基金净值走势为空")

    value_column = "单位净值" if "单位净值" in recent_df.columns else recent_df.columns[-1]
    values = [_safe_number(value) for value in recent_df[value_column].tolist()]
    trend = [value for value in values if value is not None]

    if not trend:
        raise ValueError("基金净值为空")

    date_column = "净值日期" if "净值日期" in recent_df.columns else recent_df.columns[0]
    candles: list[dict[str, Any]] = []
    previous_close = trend[0]

    for row, close_price in zip(recent_df.to_dict("records"), trend, strict=False):
        open_price = previous_close
        high_price = max(open_price, close_price)
        low_price = min(open_price, close_price)
        change_amount = close_price - open_price
        change_rate = (change_amount / open_price * 100) if open_price else 0
        amplitude = ((high_price - low_price) / open_price * 100) if open_price else 0
        candles.append(
            {
                "date": str(row.get(date_column, "")),
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close_price,
                "volume": None,
                "amount": None,
                "amplitude": amplitude,
                "changeRate": change_rate,
                "changeAmount": change_amount,
                "turnoverRate": None,
            }
        )
        previous_close = close_price

    return _trend_response(candles)


def security_trend(symbol: str, security_type: str, range_label: str) -> dict[str, Any]:
    if security_type == "基金":
        return _fund_trend(symbol, range_label)

    return _stock_trend(symbol, range_label)


class AkShareHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        _json_response(self, 204, {})

    def do_GET(self) -> None:
        parsed_url = urlparse(self.path)
        query = parse_qs(parsed_url.query)

        try:
            if parsed_url.path == "/health":
                _json_response(self, 200, {"ok": True})
                return

            if parsed_url.path == "/api/securities/search":
                keyword = query.get("q", [""])[0].strip()
                limit = int(query.get("limit", ["20"])[0])
                _json_response(self, 200, {"items": search_securities(keyword, limit)})
                return

            if parsed_url.path == "/api/securities/trend":
                symbol = query.get("symbol", [""])[0].strip()
                security_type = query.get("type", ["股票"])[0].strip()
                range_label = query.get("range", ["近一个月"])[0].strip()

                if not symbol:
                    _json_response(self, 400, {"message": "缺少 symbol 参数"})
                    return

                _json_response(self, 200, security_trend(symbol, security_type, range_label))
                return

            _json_response(self, 404, {"message": "接口不存在"})
        except Exception as error:  # noqa: BLE001 - return Python-side data source errors to the client
            _json_response(self, 500, {"message": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[akshare] {self.address_string()} - {format % args}")


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), AkShareHandler)
    print(f"AkShare service listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
