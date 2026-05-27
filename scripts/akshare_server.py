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


HOST = os.environ.get("AKSHARE_HOST", "127.0.0.1")
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
        close_column = "收盘"
    except Exception:
        hist_df = ak.stock_zh_a_daily(symbol=_daily_symbol(symbol))
        hist_df = hist_df[hist_df["date"] >= start_date.date()]
        close_column = "close"

    if hist_df.empty:
        raise ValueError("股票历史行情为空")

    close_values = [_safe_number(value) for value in hist_df[close_column].tolist()]
    trend = [value for value in close_values if value is not None]

    if not trend:
        raise ValueError("股票收盘价为空")

    first_price = trend[0]
    latest_price = trend[-1]
    change_rate = ((latest_price - first_price) / first_price * 100) if first_price else 0

    return {
        "price": latest_price,
        "changeRate": change_rate,
        "trend": trend,
    }


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

    first_price = trend[0]
    latest_price = trend[-1]
    change_rate = ((latest_price - first_price) / first_price * 100) if first_price else 0

    return {
        "price": latest_price,
        "changeRate": change_rate,
        "trend": trend,
    }


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
