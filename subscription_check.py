"""Query the current ChatGPT account directly through its web backend.

The local Vite server passes credentials in a restricted temporary file. This
process prints only a normalized result; tokens and cookies never reach stdout.
"""

import argparse
import base64
import json
import os
import sys
import uuid
from pathlib import Path
from urllib.parse import urlparse

from curl_cffi.requests import Session


BASE = "https://chatgpt.com"
COOKIE_NAMES = {
    "__Secure-next-auth.session-token",
    "oai-did",
    "oai-hlib",
    "oai-sc",
    "oaicom-stable-id",
    "_account",
    "_account_is_fedramp",
    "__Secure-oai-is",
    "__cf_bm",
    "__cflb",
    "_cfuvid",
    "__oailb",
    "cf_clearance",
}
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)


def record(value):
    return value if isinstance(value, dict) else {}


def first_string(*values):
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def first_bool(*values):
    for value in values:
        if isinstance(value, bool):
            return value
    return None


def jwt_claims(token):
    try:
        encoded = token.split(".")[1]
        padded = encoded + "=" * (-len(encoded) % 4)
        return record(json.loads(base64.urlsafe_b64decode(padded)))
    except Exception:
        return {}


def cookie_header(value):
    value = str(value or "").strip()
    if not value:
        return "", str(uuid.uuid4())
    if "=" not in value.split(";", 1)[0]:
        value = "__Secure-next-auth.session-token=" + value
    cookies = {}
    for part in value.split(";"):
        name, separator, content = part.strip().partition("=")
        if separator and name in COOKIE_NAMES:
            cookies[name] = content
    device_id = cookies.get("oai-did") or str(uuid.uuid4())
    cookies["oai-did"] = device_id
    return "; ".join(f"{key}={content}" for key, content in cookies.items()), device_id


def get_json(session, path, *, optional=False):
    try:
        response = session.get(BASE + path, timeout=35)
    except Exception as exc:
        if optional:
            return None, "网络请求失败"
        raise RuntimeError("连接 ChatGPT 失败，请检查代理设置") from exc
    if response.status_code >= 400:
        if optional:
            return None, f"HTTP {response.status_code}"
        if response.status_code in (401, 403):
            raise RuntimeError(f"ChatGPT 返回 {response.status_code}，请检查 Session 是否有效")
        raise RuntimeError(f"ChatGPT 订阅接口返回 HTTP {response.status_code}")
    try:
        payload = response.json()
    except (ValueError, TypeError) as exc:
        if optional:
            return None, "响应不是 JSON"
        raise RuntimeError("ChatGPT 订阅接口返回了非 JSON 内容") from exc
    if not isinstance(payload, dict):
        if optional:
            return None, "响应格式异常"
        raise RuntimeError("ChatGPT 订阅接口响应格式异常")
    return payload, None


def account_record(payload, preferred_id):
    accounts = record(payload.get("accounts"))
    for key, value in accounts.items():
        item = record(value)
        account = record(item.get("account"))
        if preferred_id and (account.get("account_id") == preferred_id or key == preferred_id):
            return item, preferred_id
    if preferred_id:
        return {}, preferred_id
    for key in ("default", *accounts.keys()):
        item = record(accounts.get(key))
        account_id = first_string(record(item.get("account")).get("account_id"), key if key != "default" else None)
        if account_id:
            return item, account_id
    return {}, preferred_id


def safe_document_url(value):
    if isinstance(value, dict):
        value = first_string(value.get("url"), value.get("href"))
    if not isinstance(value, str) or len(value) > 4096:
        return None
    try:
        url = urlparse(value)
    except ValueError:
        return None
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        return None
    return value


def document_link(item, keys):
    for key in keys:
        value = safe_document_url(item.get(key))
        if value:
            return value
    return None


def invoice_items(payload):
    candidates = [payload, record(payload.get("data"))]
    for parent in candidates:
        for key in ("invoices", "items", "results", "data"):
            value = parent.get(key)
            if isinstance(value, list):
                return value
    return []


def normalize_invoices(payload):
    result = []
    for raw in invoice_items(payload)[:50]:
        item = record(raw)
        if not item:
            continue
        details = {**record(item.get("invoice")), **item}
        pdf_url = document_link(details, (
            "invoice_pdf", "invoice_pdf_url", "pdf_url", "download_url",
        ))
        invoice_url = pdf_url or document_link(details, ("invoice_url", "hosted_invoice_url"))
        receipt_url = document_link(details, (
            "receipt_url", "receipt_pdf", "receipt_pdf_url", "receipt_download_url",
        ))
        if not receipt_url:
            for nested in ("receipt", "charge", "payment"):
                receipt_url = document_link(record(details.get(nested)), ("url", "receipt_url", "pdf_url"))
                if receipt_url:
                    break
        result.append({
            "id": first_string(details.get("id"), details.get("invoice_id")),
            "number": first_string(details.get("number"), details.get("invoice_number")),
            "date": first_string(details.get("created_at"), details.get("created"), details.get("date")),
            "status": first_string(details.get("status")),
            "invoice_url": invoice_url,
            "invoice_downloadable": bool(pdf_url),
            "receipt_url": receipt_url,
        })
    return result


def normalize_summary(subscriptions, account, account_id, email):
    entitlement = record(account.get("entitlement"))
    last = record(account.get("last_active_subscription"))
    subscription = record(subscriptions.get("subscription"))
    source = {**subscription, **subscriptions}
    account_info = record(account.get("account"))
    return {
        "email": first_string(email, source.get("email")),
        "account_id": account_id,
        "plan_type": first_string(source.get("plan_type"), account_info.get("plan_type")),
        "subscription_plan": first_string(source.get("subscription_plan"), source.get("current_plan"), entitlement.get("subscription_plan")),
        "has_active_subscription": first_bool(source.get("has_active_subscription"), source.get("has_active"), entitlement.get("has_active_subscription")),
        "will_renew": first_bool(source.get("will_renew"), last.get("will_renew")),
        "is_delinquent": first_bool(source.get("is_delinquent")),
        "expires_at": first_string(source.get("active_until"), source.get("expires_at"), entitlement.get("expires_at")),
        "renews_at": first_string(source.get("renews_at"), source.get("next_billing_date")),
        "cancels_at": first_string(source.get("cancels_at")),
        "grace_period_end": first_string(source.get("grace_period_end")),
        "billing_period": first_string(source.get("billing_period")),
        "billing_currency": first_string(source.get("billing_currency"), source.get("currency")),
        "purchase_origin_platform": first_string(source.get("purchase_origin_platform"), source.get("purchase_origin"), last.get("purchase_origin_platform")),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--credential-file", required=True)
    parser.add_argument("--proxy", default=os.environ.get("DIRECT_CARD_CHECKOUT_PROXY"))
    args = parser.parse_args()
    credentials = json.loads(Path(args.credential_file).read_text(encoding="utf-8"))
    token = str(credentials.get("accessToken") or "").strip()
    if not token:
        raise RuntimeError("Session 中缺少 access token")
    if not args.proxy:
        raise RuntimeError("缺少代理地址")

    claims = jwt_claims(token)
    auth = record(claims.get("https://api.openai.com/auth"))
    profile = record(claims.get("https://api.openai.com/profile"))
    preferred_id = first_string(auth.get("chatgpt_account_id"), claims.get("chatgpt_account_id"))
    email = first_string(profile.get("email"), claims.get("email"))
    cookies, device_id = cookie_header(credentials.get("cookie_header"))

    with Session(impersonate="chrome136") as session:
        session.trust_env = False
        session.proxies = {"http": args.proxy, "https": args.proxy}
        session.headers.update({
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": USER_AGENT,
            "Authorization": "Bearer " + token,
            "Origin": BASE,
            "Referer": BASE + "/",
            "oai-device-id": device_id,
        })
        if cookies:
            session.headers["Cookie"] = cookies

        checked, check_error = get_json(
            session, "/backend-api/accounts/check/v4-2023-04-27", optional=True
        )
        account, account_id = account_record(checked or {}, preferred_id)
        if not email:
            profile_payload, _ = get_json(session, "/backend-api/me", optional=True)
            profile_user = record(record(profile_payload).get("user"))
            email = first_string(record(profile_payload).get("email"), profile_user.get("email"))
        if not account_id:
            raise RuntimeError(
                "无法获取 ChatGPT account_id；请粘贴包含完整 access token 的 Session"
            )

        from urllib.parse import quote

        encoded_id = quote(account_id, safe="")
        subscriptions, subscription_error = get_json(
            session, f"/backend-api/subscriptions?account_id={encoded_id}", optional=True
        )
        if subscriptions is None and not account:
            raise RuntimeError(
                f"订阅接口请求失败（{subscription_error or '未知错误'}），且没有可用的账号订阅信息"
            )
        invoices, invoice_error = get_json(
            session, f"/backend-api/invoices?limit=50&account_id={encoded_id}", optional=True
        )

    print(json.dumps({
        "ok": True,
        "summary": normalize_summary(subscriptions or {}, account, account_id, email),
        "invoices": normalize_invoices(invoices) if invoices is not None else [],
        "subscription_error": subscription_error,
        "invoice_error": invoice_error,
        "account_check_error": check_error,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
