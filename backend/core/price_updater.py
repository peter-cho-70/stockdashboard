"""
core/price_updater.py
pykrx를 이용한 국내 주식 현재가 / 종가 갱신
KIS API 없이도 무료로 KRX 데이터 사용 가능
"""
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from sqlalchemy.orm import Session

from config.database import Stock, PriceHistory, PortfolioSnapshot, PortfolioTrade
from core.portfolio import resolve_prev_close
from core.target_alerts import check_all_targets_for_stock, check_price_move_alert
from core.market_calendar import get_latest_trading_date, get_latest_trading_date_str

logger = logging.getLogger(__name__)

# 캐치업 쿨다운 상태 파일 — 로컬 개발 중 백엔드를 자주 재시작해도 매번 전 종목
# pykrx 재스캔이 돌지 않도록, 마지막 실행 시각을 파일로 남겨 짧은 시간 내 재실행을 건너뛴다.
_CATCHUP_STATE_FILE = Path(__file__).resolve().parent.parent / "data" / "price_catchup_state.json"
CATCHUP_COOLDOWN_MINUTES = 30


def _catchup_recently_ran(cooldown_minutes: int) -> bool:
    try:
        if not _CATCHUP_STATE_FILE.exists():
            return False
        state = json.loads(_CATCHUP_STATE_FILE.read_text(encoding="utf-8"))
        last_run = datetime.fromisoformat(state["last_run"])
        return datetime.utcnow() - last_run < timedelta(minutes=cooldown_minutes)
    except Exception:
        return False


def _mark_catchup_ran():
    try:
        _CATCHUP_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _CATCHUP_STATE_FILE.write_text(
            json.dumps({"last_run": datetime.utcnow().isoformat()}), encoding="utf-8"
        )
    except Exception as e:
        logger.warning("⚠️ 캐치업 상태 파일 기록 실패(무해): %s", e)


def _tracked_stocks(db: Session, *, krx_only: bool):
    """캐치업 대상 종목 — 현재 보유 중(qty>0)이거나 한 번이라도 실제 매매된
    종목만 포함한다. 차트 미리보기·섹터 묶어보기·체결내역 종목별 집계의 현재가
    표시(`ensure_stock_for_chart`) 등으로 `Stock.is_active=True`만 찍히고 실제로는
    보유·매매된 적 없는 '조회용' 종목까지 매번 pykrx로 재스캔하면, 조회할수록
    캐치업 대상이 계속 불어나는 문제가 있어 제외한다.
    `krx_only=True`면 pykrx로 시세를 가져올 수 있는 국내(KRX) 종목만 대상으로
    한정한다(가격 이력 캐치업용). 포트폴리오 스냅샷 복원은 해외주식도 포함해야
    총 평가금액이 정확하므로 `krx_only=False`로 호출한다."""
    q = db.query(Stock).filter(
        Stock.is_active == True,
        (Stock.qty > 0) | Stock.id.in_(db.query(PortfolioTrade.stock_id).distinct()),
    )
    if krx_only:
        q = q.filter(Stock.market == "KRX")
    return q.all()


def fetch_krx_prices(symbols: list[str]) -> dict[str, dict]:
    """
    pykrx로 여러 종목 현재가/종가 일괄 조회
    반환: {symbol: {current_price, change_rate, open, high, low, volume}}
    """
    try:
        from pykrx import stock as krx
        import time

        trading_date = get_latest_trading_date_str()
        result = {}

        for symbol in symbols:
            try:
                df = krx.get_market_ohlcv_by_date(
                    trading_date, trading_date, symbol
                )
                # 장마감 직후엔 KRX가 당일 데이터를 아직 확정하지 않아 df가 비어있을 수 있다.
                # 예전엔 여기서 전일 데이터로 조용히 폴백해 "당일 종가"로 잘못 저장하는 버그가 있었다
                # (2026-07-10 스냅샷에 7/9 데이터가 그대로 중복 저장된 사고, DEVLOG 참고).
                # 데이터가 없으면 그냥 이번 갱신에서 스킵 — 이후 KIS 실시세 동기화나 다음 스케줄 실행이 채운다.
                if df.empty:
                    logger.info("%s: %s pykrx 데이터 아직 없음 (장마감 직후) — 이번 갱신 스킵", symbol, trading_date)
                    continue

                row = df.iloc[-1]
                result[symbol] = {
                    "current_price": float(row.get("종가", row.get("Close", 0))),
                    "open_price": float(row.get("시가", row.get("Open", 0))),
                    "high_price": float(row.get("고가", row.get("High", 0))),
                    "low_price": float(row.get("저가", row.get("Low", 0))),
                    "volume": float(row.get("거래량", row.get("Volume", 0))),
                    "change_rate": float(row.get("등락률", row.get("등락률", 0))),
                }
                time.sleep(0.1)  # 요청 간격 조절
            except Exception as e:
                logger.warning(f"⚠️ {symbol} 시세 조회 실패: {e}")

        return result

    except ImportError:
        logger.error("❌ pykrx 미설치. 'pip install pykrx' 실행 필요")
        return {}
    except Exception as e:
        logger.error(f"❌ pykrx 조회 오류: {e}")
        return {}


def update_prices_from_krx(db: Session, alert_threshold: float = 5.0) -> dict:
    """
    KRX 데이터로 보유 종목 현재가 갱신 + 5% 알림 체크
    KIS API 없이 사용 가능한 대안
    """
    stocks = db.query(Stock).filter(
        Stock.is_active == True,
        Stock.market == "KRX"
    ).all()

    if not stocks:
        return {"updated": 0, "alerts": []}

    symbols = [s.symbol for s in stocks]
    logger.info(f"📈 KRX 시세 갱신 시작: {len(symbols)}개 종목")

    prices = fetch_krx_prices(symbols)
    if not prices:
        logger.warning("KRX 시세 데이터 없음 (장 휴장 또는 API 오류)")
        return {"updated": 0, "alerts": []}

    updated = 0
    alerts = []

    for stock in stocks:
        p = prices.get(stock.symbol)
        if not p or p["current_price"] == 0:
            continue

        prev_price = stock.current_price
        new_price = p["current_price"]
        change_rate = p["change_rate"]

        prev_close = resolve_prev_close(
            prev_close=0,
            current_price=new_price,
            change_rate=change_rate,
            fallback_prev=stock.prev_price if stock.prev_price > 0 else prev_price,
        )

        if change_rate == 0 and prev_close > 0 and new_price != prev_close:
            change_rate = (new_price - prev_close) / prev_close * 100

        stock.prev_price = prev_close if prev_close > 0 else prev_price
        stock.current_price = new_price
        stock.change_rate = change_rate
        stock.updated_at = datetime.utcnow()
        updated += 1

        # 급등락 감지 — 임계값을 넘은 최초 1회만 알림(재갱신마다 재알림 방지)
        alerts.extend(
            check_price_move_alert(
                db, stock,
                change_rate=change_rate, prev_close=prev_close, current_price=new_price,
                threshold=alert_threshold,
            )
        )

        alerts.extend(check_all_targets_for_stock(db, stock))

    db.commit()
    logger.info(f"✅ KRX 시세 갱신 완료: {updated}개 / 알림: {len(alerts)}건")
    return {"updated": updated, "alerts": alerts}


def save_daily_snapshot(db: Session):
    """일별 포트폴리오 스냅샷 저장 — 호출 시점(wall clock)이 아니라 최근 거래일 기준으로 저장한다.
    그래야 주말/휴일이나 자정을 넘겨 실행된 재동기화가 엉뚱한 날짜에 찍히지 않는다."""
    today = get_latest_trading_date().strftime("%Y-%m-%d")
    stocks = db.query(Stock).filter(Stock.is_active == True).all()

    total_value = sum(s.current_value for s in stocks)
    total_purchase = sum(s.purchase_amount for s in stocks)
    total_profit = total_value - total_purchase
    total_profit_rate = (total_profit / total_purchase * 100) if total_purchase > 0 else 0

    # 가격 이력 저장
    for stock in stocks:
        if stock.current_price == 0:
            continue
        existing_ph = db.query(PriceHistory).filter(
            PriceHistory.stock_id == stock.id,
            PriceHistory.date == today
        ).first()
        if existing_ph:
            existing_ph.close_price = stock.current_price
            existing_ph.change_rate = stock.change_rate
        else:
            db.add(PriceHistory(
                stock_id=stock.id,
                date=today,
                close_price=stock.current_price,
                change_rate=stock.change_rate,
            ))

    # 스냅샷 저장
    existing_snap = db.query(PortfolioSnapshot).filter(
        PortfolioSnapshot.date == today
    ).first()
    if existing_snap:
        existing_snap.total_value = total_value
        existing_snap.total_purchase = total_purchase
        existing_snap.total_profit = total_profit
        existing_snap.total_profit_rate = total_profit_rate
    else:
        db.add(PortfolioSnapshot(
            date=today,
            total_value=total_value,
            total_purchase=total_purchase,
            total_profit=total_profit,
            total_profit_rate=total_profit_rate,
        ))

    db.commit()
    logger.info(f"✅ 스냅샷 저장: {today} | 총평가 {total_value:,.0f}원 | 수익률 {total_profit_rate:.2f}%")


def fetch_krx_price_range(symbol: str, start_date: str, end_date: str) -> list[dict]:
    """pykrx로 종목 하나의 날짜 범위(YYYYMMDD~YYYYMMDD) 일별 시세 조회.
    반환: 실제 거래일만 [{date: "YYYY-MM-DD", open_price, high_price, low_price,
    close_price, volume, change_rate}, ...]. 등락률은 pykrx가 전체 이력 기준으로
    계산해주므로 여기서 따로 전일 종가를 역산할 필요가 없다."""
    try:
        from pykrx import stock as krx

        df = krx.get_market_ohlcv_by_date(start_date, end_date, symbol)
        if df is None or df.empty:
            return []

        col_map = {c.lower(): c for c in df.columns}

        def gcol(row, *keywords: str) -> float:
            for kw in keywords:
                if kw in col_map:
                    return float(row[col_map[kw]])
            return 0.0

        records = []
        for idx, row in df.iterrows():
            date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            records.append({
                "date": date_str,
                "open_price": gcol(row, "시가", "open"),
                "high_price": gcol(row, "고가", "high"),
                "low_price": gcol(row, "저가", "low"),
                "close_price": gcol(row, "종가", "close"),
                "volume": gcol(row, "거래량", "volume"),
                "change_rate": gcol(row, "등락률"),
            })
        return records
    except Exception as e:
        logger.warning(f"⚠️ {symbol} 기간별 시세 조회 실패: {e}")
        return []


def catchup_price_history(db: Session, lookback_days: int = 30, *, force: bool = False) -> dict:
    """최근 lookback_days일 구간을 통째로 다시 훑어, 비어있는 날짜를 pykrx 기간
    조회로 채운다. 컴퓨터를 며칠 꺼둬서 장마감 스케줄러가 못 돈 사이(15:35 job이
    그 시각에 프로세스가 떠있어야만 도는데, 꺼둔 날은 그대로 갭이 됨)의 실제
    일별 등락률을 나중에 다시 확인할 수 있게 하는 것이 목적 — 알림(급등락)은
    만들지 않고 순수하게 조회용 이력만 복원한다.

    "마지막 저장 날짜 이후"만 보지 않고 항상 구간 전체를 다시 스캔하는 이유:
    앱을 재개했을 때 일반 시세갱신(KIS 동기화 등)이 "오늘 날짜"로 바로 최신
    이력을 써버리면, 그보다 앞선 날짜(예: 재개 며칠 전) 구멍은 "이미 최신"으로
    보여 영영 못 채우게 된다 — 마지막 날짜 이후만 보는 방식으로는 이런 중간
    구멍을 잡을 수 없다.

    `force=False`(기본, 앱 시작 시 자동 실행 경로)면 최근 `CATCHUP_COOLDOWN_MINUTES`분
    이내에 이미 실행됐으면 건너뛴다 — 로컬 개발 중 백엔드를 자주 재시작해도 매번
    전 종목 pykrx 재스캔이 돌지 않게 하기 위함. 대시보드 "놓친 시세 다시 체크"
    수동 버튼은 `force=True`로 호출해 쿨다운과 무관하게 항상 실행된다."""
    if not force and _catchup_recently_ran(CATCHUP_COOLDOWN_MINUTES):
        logger.info("ℹ️ 가격 이력 캐치업 — 최근 %s분 내 실행됨, 스킵", CATCHUP_COOLDOWN_MINUTES)
        return {"stocks_checked": 0, "stocks_filled": 0, "days_filled": 0, "skipped": "cooldown"}

    stocks = _tracked_stocks(db, krx_only=True)
    if not stocks:
        return {"stocks_checked": 0, "stocks_filled": 0, "days_filled": 0}

    latest_trading = get_latest_trading_date()
    start_date = latest_trading - timedelta(days=lookback_days)
    start_str = start_date.strftime("%Y%m%d")
    end_str = latest_trading.strftime("%Y%m%d")
    start_date_iso = start_date.strftime("%Y-%m-%d")

    stocks_filled = 0
    total_days_filled = 0

    for stock in stocks:
        existing_dates = {
            d for (d,) in db.query(PriceHistory.date)
            .filter(
                PriceHistory.stock_id == stock.id,
                PriceHistory.date >= start_date_iso,
            )
            .all()
        }

        records = fetch_krx_price_range(stock.symbol, start_str, end_str)
        if not records:
            continue

        filled = 0
        for rec in records:
            if rec["date"] in existing_dates or rec["close_price"] == 0:
                continue
            db.add(PriceHistory(
                stock_id=stock.id,
                date=rec["date"],
                open_price=rec["open_price"],
                high_price=rec["high_price"],
                low_price=rec["low_price"],
                close_price=rec["close_price"],
                volume=rec["volume"],
                change_rate=rec["change_rate"],
            ))
            filled += 1

        if filled == 0:
            continue

        # 종목별로 커밋 — 시작 시 자동 캐치업과 수동 버튼이 겹치는 등 동시 실행이
        # 우연히 겹치면 (stock_id, date) 유니크 제약에 걸릴 수 있는데, 그 종목만
        # 롤백하고 다음 종목으로 계속 진행한다 (전체 배치가 통째로 날아가지 않게).
        try:
            db.commit()
            stocks_filled += 1
            total_days_filled += filled
        except Exception as e:
            db.rollback()
            logger.warning("⚠️ %s 시세 이력 저장 실패(동시 실행 충돌 추정): %s", stock.symbol, e)
    logger.info("✅ 가격 이력 캐치업: 종목 %s개, %s일치 복원", stocks_filled, total_days_filled)
    _mark_catchup_ran()
    return {
        "stocks_checked": len(stocks),
        "stocks_filled": stocks_filled,
        "days_filled": total_days_filled,
    }


def catchup_portfolio_snapshots(db: Session, lookback_days: int = 30) -> dict:
    """`catchup_price_history`로 채운 일별 시세를 바탕으로, 여전히 비어있는 날짜의
    포트폴리오 스냅샷(총 평가금액·손익·수익률)을 복원한다. 안 켜둔 사이(장마감
    스케줄러가 못 돈 날)는 시세뿐 아니라 그날의 "내 수익"도 계산된 적이 없어서
    대시보드 일별 손익 차트에 구멍이 남는데, 이를 메운다.

    그 날짜 이후(> D) 매매가 없었던 종목은 현재 수량·평단가를 그대로 써서 정확히
    계산한다. 매매가 있었던 종목은 그 이후 체결 내역을 거꾸로 되돌려 수량만
    복원하고, 평단가는 현재값으로 근사한다(그 구간에 매수가 있었던 종목만 살짝
    부정확할 수 있음 — 매도는 평단가에 영향을 주지 않으므로 정확)."""
    latest_trading = get_latest_trading_date()
    window_start = (latest_trading - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    end_iso = latest_trading.strftime("%Y-%m-%d")

    # 해외주식도 총 평가금액에 들어가야 하므로 market 제한 없이(krx_only=False)
    # 보유 중이거나 매매 이력이 있는 종목만 대상으로 한다 — 조회용 preview 종목은 제외.
    stocks = _tracked_stocks(db, krx_only=False)
    if not stocks:
        return {"days_filled": 0}

    existing_dates = {
        d for (d,) in db.query(PortfolioSnapshot.date)
        .filter(PortfolioSnapshot.date >= window_start)
        .all()
    }

    stock_ids = [s.id for s in stocks]
    price_rows = (
        db.query(PriceHistory.stock_id, PriceHistory.date, PriceHistory.close_price)
        .filter(PriceHistory.stock_id.in_(stock_ids), PriceHistory.date >= window_start)
        .all()
    )
    price_map: dict[str, dict[int, float]] = {}
    for stock_id, d, close in price_rows:
        price_map.setdefault(d, {})[stock_id] = close

    trade_rows = (
        db.query(PortfolioTrade.stock_id, PortfolioTrade.traded_at, PortfolioTrade.side, PortfolioTrade.qty)
        .filter(PortfolioTrade.stock_id.in_(stock_ids), PortfolioTrade.traded_at > window_start)
        .all()
    )
    trades_by_stock: dict[int, list[tuple[str, str, float]]] = {}
    for stock_id, traded_at, side, qty in trade_rows:
        trades_by_stock.setdefault(stock_id, []).append((traded_at, side, qty))

    def _is_weekday(d: str) -> bool:
        return datetime.strptime(d, "%Y-%m-%d").weekday() < 5

    missing_dates = sorted(
        d for d in price_map.keys()
        if d not in existing_dates and d <= end_iso and _is_weekday(d)
    )

    filled = 0
    for d in missing_dates:
        total_value = 0.0
        total_purchase = 0.0
        for stock in stocks:
            close = price_map.get(d, {}).get(stock.id, stock.current_price)

            qty_at_d = stock.qty
            for traded_at, side, qty in trades_by_stock.get(stock.id, []):
                if traded_at > d:
                    qty_at_d += -qty if side == "BUY" else qty

            total_value += qty_at_d * close
            total_purchase += qty_at_d * stock.avg_price

        total_profit = total_value - total_purchase
        total_profit_rate = (total_profit / total_purchase * 100) if total_purchase > 0 else 0

        db.add(PortfolioSnapshot(
            date=d,
            total_value=total_value,
            total_purchase=total_purchase,
            total_profit=total_profit,
            total_profit_rate=total_profit_rate,
        ))
        filled += 1

    if filled:
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning("⚠️ 포트폴리오 스냅샷 캐치업 저장 실패(동시 실행 충돌 추정): %s", e)
            return {"days_filled": 0}

    logger.info("✅ 포트폴리오 스냅샷 캐치업: %s일치 복원", filled)
    return {"days_filled": filled}
