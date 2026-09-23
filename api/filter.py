"""Filter Checker API — server-side proxy for school-filter endpoints that
don't send CORS headers.

Routes (GET, all JSON):
  /api/filter?kind=ping                          -> {ok: true}
  /api/filter?kind=fortiguard&url=<full-url>     -> {category, blocked}
  /api/filter?kind=senso&url=<host-path>         -> [category ids]
  /api/filter?kind=linewize&url=<full-url>       -> gateway verdict JSON
  /api/filter?kind=barracuda&url=<hostname>      -> {category, blocked}
  /api/filter?kind=sophos&url=<full-url>         -> {b64: <SXL4 protobuf reply>}

Stdlib only — no pip dependencies. Works as a plain ASGI app (`app`) and as a
Lambda-style `handler`, so it runs under any of the common function hosts.
"""

import base64
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, Optional

TIMEOUT = 15
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# Some filter endpoints (FortiGuard's :3400 in particular) ship incomplete
# TLS chains — the vendor adapters ran with verification disabled too.
_INSECURE_CTX = ssl.create_default_context()
_INSECURE_CTX.check_hostname = False
_INSECURE_CTX.verify_mode = ssl.CERT_NONE

SOPHOS_ENDPOINT = "https://4.sophosxl.net/lookup"

SOPHOS_ALLOWED_PROD = frozenset(
    [0, 6, 7, 8, 10, 13, 16, 20, 23, 25, 29, 39, 41, 42, 55, 57, 61, 62, 64, 68]
)

BARRACUDA_ALLOWED = [
    "content server", "business", "information technology",
    "computers and technology", "technology", "education", "search engines",
    "search engines and portals", "portal", "news", "news and media",
    "government", "health", "medicine", "finance", "financial", "reference",
    "translation", "content delivery", "web hosting", "internet services",
    "general", "uncategorized", "unknown",
]


def _request(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    data: Optional[bytes] = None,
    timeout: int = TIMEOUT,
) -> bytes:
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("user-agent", _UA)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout, context=_INSECURE_CTX) as resp:
        return resp.read()


def _normalize_url(raw: str) -> str:
    raw = (raw or "").strip()
    if raw and "://" not in raw:
        raw = "https://" + raw
    return raw


# ── Individual checks ────────────────────────────────────────────────────────

def check_fortiguard(full_url: str) -> Dict[str, Any]:
    q = urllib.parse.quote(full_url, safe="")
    endpoint = (
        "https://wsfgd1.fortiguard.net:3400/service/wfquery"
        "?protver=1.0&cltkey=bossbaby&emssn=lol&clttype=ie&type=cate&catver=10&qurl=" + q
    )
    body = json.loads(_request(endpoint).decode("utf-8", "replace"))
    return {"raw": {"data": body.get("data", []), "status": body.get("status")}}

def check_senso(host_path: str) -> Any:
    endpoint = "https://filtering.senso.cloud/filter/lookup?url=https://" + host_path
    return json.loads(_request(endpoint).decode("utf-8", "replace"))

def check_linewize(full_url: str) -> Any:
    endpoint = (
        "https://mvgateway.syd-1.linewize.net/get/verdict"
        "?deviceid=PHYS-SMIC-US-0000-3190&cev=3.3.0&identity=null&requested_website="
        + urllib.parse.quote(full_url, safe="")
    )
    return json.loads(_request(endpoint).decode("utf-8", "replace"))

def check_barracuda(raw_target: str) -> Dict[str, Any]:
    # Accept either a bare hostname or a full URL; the form wants just the host.
    from urllib.parse import urlparse
    import re
    import http.cookiejar
    target = raw_target.strip()
    if "://" in target:
        target = urlparse(target).hostname or target
    target = target.lower().removeprefix("www.")
    form = urllib.parse.urlencode(
        {"lookup_entry": target, "submit": "Check Reputation"}
    ).encode()
    # Barracuda's form endpoint only answers with a browser-like UA + referer
    # AND a session cookie from a prior GET of the same page (verified live
    # 2026-09: POSTs without a session get a bare form page back, which the
    # old code mis-parsed into "Barracuda parse failed"). Warm the session
    # first with a cookie jar, then POST exactly like the form does.
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPSHandler(context=_INSECURE_CTX),
    )
    page_url = "https://www.barracudacentral.org/lookups/lookup-reputation"
    browser_headers = {
        "user-agent": _UA,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
    }
    warm = urllib.request.Request(page_url, headers=dict(browser_headers, referer=page_url))
    opener.open(warm, timeout=TIMEOUT).read()
    post = urllib.request.Request(
        page_url,
        data=form,
        method="POST",
        headers=dict(
            browser_headers,
            referer=page_url,
            origin="https://www.barracudacentral.org",
            **{"content-type": "application/x-www-form-urlencoded"},
        ),
    )
    html = opener.open(post, timeout=TIMEOUT).read().decode("utf-8", "replace")
    if "does not exist in our WebFilter content database." in html:
        return {"category": "Uncategorized", "blocked": True}
    m = re.search(r"was found under the following categories:\s*<strong>(.*?)</strong>", html)
    if not m:
        raise ValueError("barracuda parse failed")
    cat = ", ".join(
        " ".join(w[:1].upper() + w[1:] for w in part.strip().split("-"))
        for part in m.group(1).split(",")
    )
    cl = cat.lower()
    blocked = not any(a in cl for a in BARRACUDA_ALLOWED)
    return {"category": cat, "blocked": blocked}

# ── Sophos SXL4 protobuf (mirrors src/filter-apis/vendor/sophos.ts) ─────────

def _varint(value: int) -> bytes:
    out = bytearray()
    v = value & 0xFFFFFFFF
    while v >= 0x80:
        out.append((v & 0x7F) | 0x80)
        v >>= 7
    out.append(v)
    return bytes(out)

def _tag(field: int, wire: int) -> bytes:
    return _varint((field << 3) | wire)

def _bytes_field(field: int, data: bytes) -> bytes:
    return _tag(field, 2) + _varint(len(data)) + data

def _str_field(field: int, s: str) -> bytes:
    return _bytes_field(field, s.encode("utf-8"))

def _varint_field(field: int, value: int) -> bytes:
    return _tag(field, 0) + _varint(value)

def _msg_field(field: int, payload: bytes) -> bytes:
    return _bytes_field(field, payload)

def sophos_lookup(full_url: str) -> Dict[str, Any]:
    machine_id = bytes(range(16))  # deterministic per-deployment ID is fine here
    creds = _bytes_field(1, b"CHROME_EXTENSION") + _bytes_field(2, machine_id)
    product = _varint_field(1, 26) + _str_field(4, "1.0.0")
    url_query = _msg_field(1, _str_field(1, full_url))
    lookup = _varint_field(1, 2) + _msg_field(3, url_query)
    body = (
        _varint_field(1, 503307768)
        + _varint_field(2, 2)
        + _msg_field(3, creds)
        + _msg_field(4, product)
        + _msg_field(5, lookup)
    )
    reply = _request(
        SOPHOS_ENDPOINT,
        method="POST",
        headers={"Content-Type": "application/octet-stream"},
        data=body,
    )
    return {"b64": base64.b64encode(reply).decode("ascii")}


CHECKS: Dict[str, Callable[[str], Any]] = {
    "fortiguard": check_fortiguard,
    "senso": check_senso,
    "linewize": check_linewize,
    "barracuda": check_barracuda,
    "sophos": sophos_lookup,
}


def handle_query(params: Dict[str, str]) -> Dict[str, Any]:
    kind = (params.get("kind") or "").strip().lower()
    if kind == "ping":
        return {"ok": True}
    fn = CHECKS.get(kind)
    if fn is None:
        return {"error": f"unknown kind '{kind}'"}
    url = _normalize_url(params.get("url") or "")
    if not url:
        return {"error": "missing url"}
    return {"result": fn(url)}


# ── ASGI entrypoint ──────────────────────────────────────────────────────────

async def app(scope, receive, send):  # type: ignore[no-untyped-def]
    if scope["type"] == "lifespan":
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return

    if scope["type"] != "http":
        return

    try:
        from urllib.parse import parse_qs
        raw = scope.get("query_string", b"")
        params = {k: v[0] for k, v in parse_qs(raw.decode("latin-1")).items()}
        payload = handle_query(params)
        status = 200
    except Exception as exc:  # noqa: BLE001 — surface any failure to the client
        payload = {"error": f"{type(exc).__name__}: {exc}"}
        status = 502

    body = json.dumps(payload).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                [b"content-type", b"application/json"],
                [b"access-control-allow-origin", b"*"],
                [b"cache-control", b"no-store"],
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


# Lambda-style alias for hosts that expect `handler`.
def handler(event, context):  # type: ignore[no-untyped-def]
    params = {}
    qs = (event or {}).get("queryStringParameters") or {}
    params.update({k: v for k, v in qs.items() if v is not None})
    try:
        payload = handle_query(params)
        status = 200
    except Exception as exc:  # noqa: BLE001
        payload = {"error": f"{type(exc).__name__}: {exc}"}
        status = 502
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "access-control-allow-origin": "*"},
        "body": json.dumps(payload),
    }
