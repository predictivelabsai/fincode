import json
import os
from datetime import datetime
from typing import List, Dict, Any, Optional
from uuid import uuid4

class PortfolioManager:
    """Manages local paper trading portfolio."""

    def __init__(self, storage_path: str = "data/paper_trades.json"):
        self.storage_path = storage_path
        os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)
        self.trades = self._load_trades()

    def _load_trades(self) -> List[Dict[str, Any]]:
        if not os.path.exists(self.storage_path):
            return []
        try:
            with open(self.storage_path, 'r') as f:
                return json.load(f)
        except Exception:
            return []

    def _save_trades(self):
        with open(self.storage_path, 'w') as f:
            json.dump(self.trades, f, indent=2)

    def add_trade(self, market_id: str, question: str, amount: float, price: float):
        """Record a new paper trade."""
        trade = {
            "id": f"T-{uuid4().hex}",
            "timestamp": datetime.now().isoformat(),
            "market_id": market_id,
            "question": question,
            "amount": amount,
            "entry_price": price,
            "shares": amount / price if price > 0 else 0,
            "status": "OPEN",
            "payout": 0,
            "exit_price": None
        }
        self.trades.append(trade)
        self._save_trades()
        return trade

    def get_trades(self) -> List[Dict[str, Any]]:
        return self.trades

    def update_trade_status(self, market_id: str, status: str, payout: float = 0):
        """Update status for all trades of a specific market."""
        changed = False
        for t in self.trades:
            if t["market_id"] == market_id and t["status"] == "OPEN":
                t["status"] = status
                t["payout"] = payout
                changed = True
        if changed:
            self._save_trades()

    def close_trade_by_id(self, trade_id: str, exit_price: float) -> Optional[Dict[str, Any]]:
        """Close a specific trade by its transaction ID."""
        for t in self.trades:
            # Handle full ID or short ID suffix
            if t["id"] == trade_id or t["id"].endswith(trade_id):
                if t["status"] == "OPEN":
                    t["status"] = "SOLD"
                    t["exit_price"] = exit_price
                    t["payout"] = t["shares"] * exit_price
                    self._save_trades()
                    return t
        return None
