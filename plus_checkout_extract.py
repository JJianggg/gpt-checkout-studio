#!/usr/bin/env python3
"""Apply the observed ChatGPT web Plus checkout fields to the shared extractor."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any


EXTRACTOR_DIR = Path.cwd() / "services" / "protocol-payment" / "direct_card"
sys.path.insert(0, str(EXTRACTOR_DIR))

import direct_card_extract as direct_card  # noqa: E402


class PlusRequestSession:
    def __init__(self, session: Any) -> None:
        self.session = session

    def __getattr__(self, name: str) -> Any:
        return getattr(self.session, name)

    def post(self, url: str, **kwargs: Any) -> Any:
        if url == direct_card.CHECKOUT_URL:
            body = dict(kwargs.get("json") or {})
            body["checkout_source"] = "chatgpt_web_classic"
            headers = dict(kwargs.get("headers") or {})
            headers.update(
                {
                    "x-openai-checkout-source": "chatgpt_web_classic",
                    "x-openai-target-path": "/backend-api/payments/checkout",
                    "x-openai-target-route": "/backend-api/payments/checkout",
                    "x-openai-web-frontend": "core_web",
                }
            )
            kwargs.update(json=body, headers=headers)
        return self.session.post(url, **kwargs)


class PlusCheckoutExtractor(direct_card.CheckoutExtractor):
    def _create_checkout(self, session: Any) -> dict[str, Any]:
        if self.config.plan_name != "chatgptplusplan" or self.config.checkout_ui_mode != "custom":
            raise direct_card.ExtractorError("Plus checkout requires chatgptplusplan and custom mode")
        return super()._create_checkout(PlusRequestSession(session))


if __name__ == "__main__":
    direct_card.CheckoutExtractor = PlusCheckoutExtractor
    raise SystemExit(direct_card.main())
