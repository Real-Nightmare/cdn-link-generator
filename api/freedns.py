"""FreeDNS automation relay — puts YOUR IP into a freedns.afraid.org record.

This is the server half of the Studio's in-app FreeDNS automation: the same
flow as `domain92` (github.com/sebastian-92/domain92), which automates
freedns.afraid.org account + subdomain creation using ading2210's
freedns-client and a temp-mail activation. Here the browser drives the flow
through this relay (freedns.afraid.org sends no CORS headers, so the calls
can't run from the page directly), and the activation email is received and
opened automatically by the same relay — no external inbox needed.

Route (GET, JSON):
  /api/freedns?kind=<op>&...   →  {"result": ...}  |  {"error": "..."}

Operations
──────────
  kind=ping                                    -> {"ok": true}
  kind=captcha[&sid=]                          -> {"sid", "b64": png base64}
  kind=webip                                   -> {"ip": requester public IP}
  kind=newmail                                 -> {"email", "msid"} temp inbox
  kind=signup&sid=&first=&last=&user=&pass=&email=&captcha=<code>
  kind=activate&code=<activation code>         (manual fallback)
  kind=autoactivate&sid=<freedns sid>&msid=<mail sid>
                                               -> waits for the FreeDNS
                                                  activation mail in the temp
                                                  inbox and opens the link
  kind=login&sid=&user=&pass=
  kind=registry&sid=&page=<n>&query=<text>
        [&sort=1..6][&least=1]                 -> domains list + paging.
        sort: FreeDNS registry ordering (5 = popularity, the default).
        least=1 counts pages from the LEAST-popular end: page=1 is the last
        registry page, where domains have only a handful of hosts (live-verified
        2026-09: page 214/214 = 3–4 hosts, page 1 = mooo.com's 870k). Tiny
        shared domains give the freshest, least-burned subdomains.
  kind=create&sid=&type=&sub=&did=&dest=&captcha=<code>
  kind=records&sid=                            -> subdomains in the account
  kind=update&sid=&id=&type=&dest=&captcha=<code>
  kind=dyndns&provider=duckdns|dynv6|dynu|noip|changeip|desec
        &host=<name>&ip=<addr>&[token=]&[user=&pass=]
                                               -> {"ok": true, reply}
  kind=registrybrowse&page=<n>[&query=][&sort=1..6][&least=1]
                                               -> domains + paging WITHOUT
        a FreeDNS login (the registry page is public). Lets the browser
        browse the shared-domain list even when only static hosting is
        available; the client can also scrape the public page itself via
        CORS relays as a final fallback.

`sid` is the relay-side FreeDNS session id returned by captcha/login.
`msid` is the temp-mail session id from newmail. Sessions live in memory
only; they die with the process (a fresh login takes one call).

Automation flow (all of it in-app, mirroring domain92):
  captcha → solve → newmail → signup(email=<temp>) → autoactivate → login
  → registry → create(A record: sub=<name>, did=<domain id>, dest=<your IP>)
  → the record appears in BYOD (type it into the box) → links come out on it.

Stdlib only — no pip dependencies. Works as a plain ASGI app (`app`) and as a
Lambda-style `handler`, matching api/filter.py.

Note on records: FreeDNS A records map a hostname to your IPv4; CNAME points
at a name. That record — e.g. `mybox.mooo.com A 203.0.113.7` — is exactly what
the BYOD host field wants: paste `mybox.mooo.com` into the BYOD box and every
asset × commit gains a link served through it.
"""

import base64
import hashlib
import html
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, List, Optional, Tuple

TIMEOUT = 20
BASE = "https://freedns.afraid.org"

_UA = (
    "Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0"
)

# Some hops on the path ship incomplete TLS chains (the freedns-client used
# verification-disabled requests too).
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE

_SESSIONS: Dict[str, "Session"] = {}
_SESSION_TTL = 60 * 60  # 1h


class FreednsError(Exception):
    """Raised with the human-readable FreeDNS error for the UI."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Stop urllib's auto-redirect: FreeDNS answers login/signup/save with a
    302 (= success) or a 200 error page (= failure), and freedns-client keys
    on exactly that. The opener must surface the 302, not follow it."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


class Session:
    """Cookie-carrying FreeDNS session (mirrors freedns.Client's requests.Session)."""

    def __init__(self) -> None:
        import http.cookiejar

        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            _NoRedirect,
            urllib.request.HTTPCookieProcessor(self.jar),
            urllib.request.HTTPSHandler(context=_CTX),
        )
        self.created = time.time()
        # (query,sort) → {total,pages} for least-popular paging; avoids a
        # page-1 fetch on every tail-page turn.
        self._reg_totals: Dict[str, Dict[str, int]] = {}

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        h = {
            "user-agent": _UA,
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.5",
            "referer": BASE + "/",
        }
        if extra:
            h.update(extra)
        return h

    def _send(self, req: urllib.request.Request) -> Tuple[int, str]:
        """(status, body-or-location). 3xx returns (code, Location) — the
        FreeDNS success signal. 4xx/5xx raise with a short body excerpt."""
        try:
            with self.opener.open(req, timeout=TIMEOUT) as resp:
                return resp.status, resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if 300 <= e.code < 400:
                return e.code, e.headers.get("Location", "")
            body = e.read().decode("utf-8", "replace")
            raise FreednsError(f"FreeDNS HTTP {e.code}: {body[:200]}") from e

    def get(self, url: str, extra: Optional[Dict[str, str]] = None) -> Tuple[int, str]:
        return self._send(urllib.request.Request(url, headers=self._headers(extra)))

    def get_bytes(self, url: str) -> bytes:
        try:
            with self.opener.open(urllib.request.Request(url, headers=self._headers()), timeout=TIMEOUT) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise FreednsError(f"FreeDNS HTTP {e.code} fetching captcha") from e

    def post(self, url: str, data: Dict[str, str]) -> Tuple[int, str]:
        body = urllib.parse.urlencode(data).encode()
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers=self._headers({"content-type": "application/x-www-form-urlencoded"}),
        )
        return self._send(req)

    @staticmethod
    def redirected(status: int) -> bool:
        return 300 <= status < 400
    # ── freedns-client flow ─────────────────────────────────────────────────
    def captcha_png(self) -> bytes:
        return self.get_bytes(BASE + "/securimage/securimage_show.php")

    def signup(self, first: str, last: str, user: str, password: str, email: str, captcha: str) -> None:
        status, body = self.post(
            BASE + "/signup/?step=2",
            {
                "plan": "starter",
                "firstname": first,
                "lastname": last,
                "username": user,
                "password": password,
                "password2": password,
                "email": email,
                "captcha_code": captcha,
                "tos": "1",
                "affirm": "1",
                "PROCID": "",
                "TRANSPRE": "",
                "action": "signup",
                "send": "Send+activation+email",
            },
        )
        if Session.redirected(status):
            return
        raise FreednsError(_signup_errors(body) or "signup failed (wrong captcha?)")

    def activate(self, code: str) -> None:
        status, body = self.get(BASE + f"/signup/activate.php?{code}")
        if Session.redirected(status):
            return
        raise FreednsError(_table_error(body) or "activation failed (bad code?)")

    def login(self, user: str, password: str) -> None:
        status, body = self.post(
            BASE + "/zc.php?step=2",
            {
                "username": user,
                "password": password,
                "remember": "1",
                "submit": "Login",
                "remote": "",
                "from": "",
                "action": "auth",
            },
        )
        if Session.redirected(status):
            return
        raise FreednsError(_table_error(body) or "login failed (bad credentials or captcha required)")

    def registry(self, page: int = 1, query: str = "", sort: int = 5, least: bool = False) -> Dict[str, Any]:
        """Public domain registry. With least=True, `page` counts from the
        LEAST-popular end (page 1 = the very last registry page), so the UI
        can offer the tiny shared domains first without knowing the page
        count. The total (per query) is cached on the session."""
        qs = f"&q={urllib.parse.quote(query)}" if query else ""
        if not least:
            _, body = self.get(BASE + f"/domain/registry/?page={page}&sort={sort}{qs}")
            out = _parse_registry(body)
            out.update({"page": page, "least": False})
            return out

        cached = self._reg_totals.get(query)
        if not cached:
            _, b1 = self.get(BASE + f"/domain/registry/?page=1&sort={sort}{qs}")
            p1 = _parse_registry(b1)
            cached = {"total": p1["total"], "pages": p1["pages"]}
            self._reg_totals[query] = cached
        target = max(1, cached["pages"] - page + 1)
        _, body = self.get(BASE + f"/domain/registry/?page={target}&sort={sort}{qs}")
        out = _parse_registry(body)
        out.update({"page": target, "pages": cached["pages"], "total": cached["total"], "least": True})
        return out

    # ── dynamic-DNS updaters (DuckDNS & co) — stateless, no FreeDNS session ──
    def dyndns_update(self, provider: str, host: str, ip: str, token: str = "", user: str = "", password: str = "") -> Dict[str, Any]:
        """Point a dynamic-DNS hostname at an IP. Endpoint shapes verified
        live 2026-09 (see scripts/probe-dyndns-apis.mjs): duckdns → 'OK',
        dynv6 → 200 'addresses updated', dynu/noip → dyndns2 'good <ip>'
        (basic auth), changeip → query-param creds, desec → basic auth where
        the username is the zone and the password is the account token."""
        import base64

        host = host.strip().lower()
        ip = ip.strip()
        if not host or not ip:
            raise FreednsError("dyndns needs host and ip")

        basic = None
        ok: Callable[[int, str], bool]
        if provider == "duckdns":
            label = host.split(".")[0]  # the API wants the label, not the FQDN
            url = (
                "https://www.duckdns.org/update?domains=" + urllib.parse.quote(label)
                + "&token=" + urllib.parse.quote(token)
                + "&ip=" + urllib.parse.quote(ip)
                + "&verbose=true"
            )
            ok = lambda s, b: b.upper().startswith("OK")  # noqa: E731
        elif provider == "dynv6":
            url = (
                "https://dynv6.com/api/update?hostname=" + urllib.parse.quote(host)
                + "&token=" + urllib.parse.quote(token)
                + "&ipv4=" + urllib.parse.quote(ip)
            )
            ok = lambda s, b: s == 200 and "updated" in b.lower()  # noqa: E731
        elif provider in ("dynu", "noip"):
            hp = "https://api.dynu.com/nic/update" if provider == "dynu" else "https://dynupdate.no-ip.com/nic/update"
            url = hp + "?hostname=" + urllib.parse.quote(host) + "&myip=" + urllib.parse.quote(ip)
            basic = (user, password)
            ok = lambda s, b: b.lower().startswith(("good", "nochg"))  # noqa: E731
        elif provider == "changeip":
            url = (
                "https://nic.changeip.com/nic/update?u=" + urllib.parse.quote(user)
                + "&p=" + urllib.parse.quote(password)
                + "&hostname=" + urllib.parse.quote(host)
                + "&myip=" + urllib.parse.quote(ip)
            )
            ok = lambda s, b: s == 200 and "badauth" not in b.lower() and "error" not in b.lower()  # noqa: E731
        elif provider == "desec":
            url = "https://update.dedyn.io/?myipv4=" + urllib.parse.quote(ip)
            basic = (host, token)  # deSEC: username = zone, password = token
            ok = lambda s, b: b.lower().startswith(("good", "nochg"))  # noqa: E731
        else:
            raise FreednsError(f"unknown dyndns provider '{provider}'")

        headers = {"user-agent": "cdn-link-studio-relay/1.0 (dyndns2 client)"}
        if basic:
            headers["authorization"] = "Basic " + base64.b64encode(f"{basic[0]}:{basic[1]}".encode()).decode("ascii")
        status, body = self.get(url, extra=headers)
        reply = re.sub(r"\s+", " ", body).strip()[:200]
        if not ok(status, body):
            raise FreednsError(f"{provider} refused: HTTP {status} — {reply or '(empty reply)'}")
        return {"ok": True, "provider": provider, "host": host, "ip": ip, "reply": reply}

    def records(self) -> List[Dict[str, Any]]:
        _, body = self.get(BASE + "/subdomain/")
        return _parse_subdomains(body)

    def create_record(self, rtype: str, sub: str, domain_id: str, dest: str, captcha: str) -> None:
        status, body = self.post(
            BASE + "/subdomain/save.php?step=2",
            {
                "type": rtype,
                "subdomain": sub,
                "domain_id": domain_id,
                "address": dest,
                "ttlalias": "For+our+premium+supporters",
                "captcha_code": captcha,
                "ref": "",
                "send": "Save!",
            },
        )
        if Session.redirected(status):
            return
        raise FreednsError(_table_error(body) or "record creation failed (subdomain taken? captcha wrong?)")

    def update_record(self, rec_id: str, rtype: Optional[str], dest: Optional[str], captcha: str) -> None:
        payload = {
            "data_id": rec_id,
            "captcha_code": captcha,
            "ttlalias": "For our premium supporters",
            "ref": "",
            "send": "Save!",
        }
        if rtype:
            payload["type"] = rtype
        if dest:
            payload["address"] = dest
        status, body = self.post(BASE + "/subdomain/save.php?step=2", payload)
        if Session.redirected(status):
            return
        raise FreednsError(_table_error(body) or "record update failed (captcha wrong?)")


# ── HTML scraping helpers (same contracts freedns-client relies on) ──────────


def _text(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", fragment)).replace("&nbsp;", " ")


def _table_error(page: str) -> str:
    """The 95%-wide table with a #eeeeee cell holds FreeDNS error messages."""
    m = re.search(r'table[^>]*width="?95%?"?[^>]*>.*?bgcolor="?#eeeeee"?[^>]*>(.*?)</td>', page, re.S | re.I)
    if not m:
        return ""
    msg = _text(m.group(1)).strip()
    return re.sub(r"\s+", " ", msg)[:300]


def _signup_errors(page: str) -> str:
    """The 420px-wide signup table lists errors in <b> elements."""
    m = re.search(r'table[^>]*width="?420"?[^>]*>.*?</table>', page, re.S | re.I)
    if not m:
        return _table_error(page)
    errs = re.findall(r"<b>(.*?)</b>", m.group(0), re.S | re.I)
    msgs = [re.sub(r"\s+", " ", _text(e)).strip(" -:") for e in errs]
    msgs = [m for m in msgs if m]
    return "; ".join(msgs[:6])


def _parse_registry(page: str) -> Dict[str, Any]:
    """Parse /domain/registry/. FreeDNS writes attributes UNQUOTED
    (href=/subdomain/edit.php?edit_domain_id=29) — every pattern here must
    tolerate that. Live-verified against the real page (2026-09)."""
    domains: List[Dict[str, Any]] = []
    for row in re.findall(r'<tr class="?tr[ld]"?>.*?</tr>', page, re.S | re.I):
        # Capture through </a>, not to the next '<': q= search results wrap the
        # match in <font color=red>mooo</font>.com INSIDE the anchor, so the
        # old ([^<]+)< capture lost every search row (live-verified 2026-09).
        m = re.search(r"edit_domain_id=(\d+)[^>]*>(.*?)</a>", row, re.S | re.I)
        if not m:
            continue
        dom_id = int(m.group(1))
        # Tags → empty (not space): 'mooo</font>.com' must become 'mooo.com'.
        name = html.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()
        if not name:
            continue
        hosts = 0
        mh = re.search(r"\(([\d,]+)\s+hosts?", _text(row))
        if mh:
            hosts = int(mh.group(1).replace(",", ""))
        status = ""
        ms = re.search(r"<td>\s*(public|private)\s*</td>", row, re.I)
        if ms:
            status = ms.group(1).lower()
        domains.append({"domain": name, "id": dom_id, "hosts": hosts, "status": status})
    # Counter: 'Showing <b>1</b>-<b>100</b> of <b>21,364</b> total' — digits
    # are wrapped in <b>; strip tags around the fragment before parsing.
    total = 0
    mi = page.find("Showing")
    if mi != -1:
        frag = _text(page[mi : mi + 300])
        mt = re.search(r"Showing\s*[\d,]+\s*-\s*[\d,]+\s*of\s*([\d,]+)\s*total", frag)
        if mt:
            total = int(mt.group(1).replace(",", ""))
    pages_total = max(1, -(-total // 100)) if total else 1  # 100 rows per page
    return {"total": total, "pages": pages_total, "domains": domains}


def _parse_subdomains(page: str) -> List[Dict[str, Any]]:
    """Parse /subdomain/ (the account's records). Rows live inside the
    delete2.php form; each record row links edit.php?data_id=<id>."""
    out: List[Dict[str, Any]] = []
    for row in re.findall(r"<tr[^>]*>.*?</tr>", page, re.S | re.I):
        m = re.search(r'data_id="?(\d+)', row)
        if not m:
            continue
        rec_id = m.group(1)
        # Anchor text of the link that carried the data_id.
        nm = re.search(r'<a[^>]*data_id="?' + rec_id + r'[^>]*>([^<]+)</a>', row, re.S | re.I)
        name = _text(nm.group(1)).strip() if nm else ""
        rest = row[m.end():]
        cells = re.findall(r"<td[^>]*>(.*?)</td>", rest, re.S | re.I)
        rtype = _text(cells[0]).strip() if cells else ""
        dest = _text(cells[-1]).strip() if cells else ""
        out.append({"id": rec_id, "subdomain": name, "type": rtype, "destination": dest})
    return out


# ── temp-mail auto-activation (exactly what domain92 does: guerrillamail) ────

GUERRILLA_API = "https://api.guerrillamail.com/ajax.php"


def _greq(params: Dict[str, str]) -> Dict[str, Any]:
    url = GUERRILLA_API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"user-agent": _UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def new_mailbox() -> Dict[str, str]:
    """Fresh guerrillamail inbox — the address to sign up with."""
    data = _greq({"f": "get_email_address", "lang": "en"})
    email = str(data.get("email_addr", ""))
    sid = str(data.get("sid_token", ""))
    if not email or not sid:
        raise FreednsError("temp-mail service did not return an inbox")
    return {"email": email, "msid": sid}


def _mail_wait_and_activate(msid: str, session: Session, tries: int = 24) -> str:
    """Poll the temp inbox for the FreeDNS activation mail and open its link
    with the FreeDNS session. Returns the activation code that worked."""
    last_err = ""
    for _ in range(tries):
        try:
            data = _greq({"f": "check_email", "seq": "0", "sid_token": msid})
            for msg in data.get("list", []):
                sender = str(msg.get("mail_from", ""))
                if "afraid.org" not in sender.lower():
                    continue
                detail = _greq(
                    {"f": "fetch_email", "email_id": str(msg.get("mail_id")), "sid_token": msid}
                )
                body = str(detail.get("mail_body", ""))
                # The link is /signup/activate.php?<code> — the code is
                # everything after the '?', per domain92/freedns-client.
                m = re.search(r"activate\.php\?([A-Za-z0-9=&_%-]+)", body)
                if not m:
                    continue
                code = m.group(1).rstrip("&=")
                session.activate(code)
                return code
            time.sleep(5)
        except Exception as exc:  # noqa: BLE001 — keep polling on transient errors
            last_err = f"{type(exc).__name__}: {exc}"
            time.sleep(3)
    raise FreednsError(
        "No activation mail arrived within the wait window"
        + (f" ({last_err})" if last_err else "")
        + " — use kind=activate with the code from a real inbox instead."
    )


# ── Session bookkeeping ──────────────────────────────────────────────────────


def _new_session() -> str:
    for _ in range(50):  # pragma: no cover — collision-freedom is a formality
        sid = hashlib.sha256(f"{time.time_ns()}".encode()).hexdigest()[:24]
        if sid not in _SESSIONS:
            break
    _SESSIONS[sid] = Session()
    _gc_sessions()
    return sid


def _get_session(sid: str) -> Session:
    s = _SESSIONS.get(sid)
    if not s:
        raise FreednsError("session expired — log in again")
    return s


def _gc_sessions() -> None:
    now = time.time()
    stale = [k for k, v in _SESSIONS.items() if now - v.created > _SESSION_TTL]
    for k in stale:
        _SESSIONS.pop(k, None)


# ── HTTP surface ─────────────────────────────────────────────────────────────


def _q(params: Dict[str, str], key: str, default: str = "") -> str:
    return (params.get(key) or default).strip()


def handle_query(params: Dict[str, str]) -> Dict[str, Any]:
    kind = _q(params, "kind").lower()

    if kind == "ping":
        return {"ok": True}

    if kind == "captcha":
        sid = _q(params, "sid")
        if sid:
            # Captcha WITHIN an existing (e.g. logged-in) session — record
            # creation/update on freedns.afraid.org are captcha-gated too.
            s = _get_session(sid)
        else:
            s = Session()
            sid = _new_session()
            _SESSIONS[sid] = s
        png = s.captcha_png()
        return {"sid": sid, "b64": base64.b64encode(png).decode("ascii")}

    if kind == "webip":
        ip = _q(params, "ip")
        if not ip:
            raise FreednsError("webip needs the client IP from the host")
        return {"ip": ip}

    if kind == "signup":
        sid = _q(params, "sid")
        if not sid:
            raise FreednsError("captcha first — send kind=captcha, solve it, then signup with its sid")
        s = _get_session(sid)
        s.signup(
            _q(params, "first", "Studio"),
            _q(params, "last", "User"),
            _q(params, "user"),
            _q(params, "pass"),
            _q(params, "email"),
            _q(params, "captcha"),
        )
        return {"sid": sid, "email": _q(params, "email")}

    if kind == "activate":
        code = _q(params, "code")
        if not code:
            raise FreednsError("missing activation code")
        s = Session()
        s.activate(code)
        return {"activated": True}

    if kind == "newmail":
        return new_mailbox()

    if kind == "autoactivate":
        sid = _q(params, "sid")
        msid = _q(params, "msid")
        if not sid or not msid:
            raise FreednsError("autoactivate needs sid (freedns session) and msid (temp-mail session)")
        s = _get_session(sid)
        code = _mail_wait_and_activate(msid, s)
        return {"activated": True, "code": code}

    if kind == "login":
        user = _q(params, "user")
        password = _q(params, "pass")
        if not user or not password:
            raise FreednsError("missing user/pass")
        sid = _q(params, "sid") or _new_session()
        s = _get_session(sid)
        s.login(user, password)
        return {"sid": sid, "user": user}

    if kind == "registry":
        sid = _q(params, "sid")
        if not sid:
            raise FreednsError("login first")
        s = _get_session(sid)
        page = int(_q(params, "page", "1") or "1")
        try:
            sort = int(_q(params, "sort", "5") or "5")
        except ValueError:
            sort = 5
        sort = min(6, max(1, sort))
        return s.registry(page=page, query=_q(params, "query"), sort=sort, least=_q(params, "least") == "1")

    if kind == "registrybrowse":
        # Sessionless registry browsing — the public page needs no login.
        page = int(_q(params, "page", "1") or "1")
        try:
            sort = int(_q(params, "sort", "5") or "5")
        except ValueError:
            sort = 5
        sort = min(6, max(1, sort))
        s = Session()
        return s.registry(page=page, query=_q(params, "query"), sort=sort, least=_q(params, "least") == "1")

    if kind == "dyndns":
        provider = _q(params, "provider").lower()
        if provider not in {"duckdns", "dynv6", "dynu", "noip", "changeip", "desec"}:
            raise FreednsError("provider must be duckdns, dynv6, dynu, noip, changeip or desec")
        s = Session()
        return s.dyndns_update(
            provider,
            _q(params, "host"),
            _q(params, "ip"),
            token=_q(params, "token"),
            user=_q(params, "user"),
            password=_q(params, "pass"),
        )

    if kind == "create":
        sid = _q(params, "sid")
        if not sid:
            raise FreednsError("login first")
        s = _get_session(sid)
        rtype = _q(params, "type", "A").upper()
        if rtype not in {"A", "AAAA", "CNAME"}:
            raise FreednsError("type must be A, AAAA or CNAME")
        sub = _q(params, "sub")
        did = _q(params, "did")
        dest = _q(params, "dest")
        if not sub or not did or not dest:
            raise FreednsError("missing sub/domain_id/dest")
        s.create_record(rtype, sub, did, dest, _q(params, "captcha"))
        return {"created": f"{sub}.{_domain_name(s, did)}", "type": rtype, "destination": dest}

    if kind == "records":
        sid = _q(params, "sid")
        if not sid:
            raise FreednsError("login first")
        s = _get_session(sid)
        return {"records": s.records()}

    if kind == "update":
        sid = _q(params, "sid")
        if not sid:
            raise FreednsError("login first")
        s = _get_session(sid)
        rec_id = _q(params, "id")
        if not rec_id:
            raise FreednsError("missing record id")
        s.update_record(rec_id, _q(params, "type") or None, _q(params, "dest") or None, _q(params, "captcha"))
        return {"updated": rec_id}

    raise FreednsError(f"unknown kind '{kind}'")


def _domain_name(s: Session, domain_id: str) -> str:
    """Best-effort pretty-print of the created host's domain suffix."""
    try:
        for d in s.registry(page=1, query="", sort=5)["domains"]:
            if str(d["id"]) == str(domain_id):
                return d["domain"]
    except Exception:  # noqa: BLE001 — cosmetic only
        pass
    return "…"


# ── ASGI entrypoint (mirrors api/filter.py) ──────────────────────────────────


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
        if params.get("kind", "").lower() == "webip":
            # The requester's public IP (proxy-aware) — the default value for
            # the A record that puts their box on the internet.
            client = scope.get("client") or ("", 0)
            ip = ""
            for k, v in scope.get("headers", []) or []:
                if k.decode("latin-1").lower() == "x-forwarded-for":
                    ip = v.decode("latin-1").split(",")[0].strip()
                    break
            params["ip"] = ip or client[0]
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
    if params.get("kind", "").lower() == "webip" and not params.get("ip"):
        headers = (event or {}).get("headers") or {}
        fwd = headers.get("x-forwarded-for") or headers.get("X-Forwarded-For") or ""
        params["ip"] = str(fwd).split(",")[0].strip() or (event or {}).get("requestContext", {}).get("identity", {}).get("sourceIp", "")
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


# ── stdlib self-host server (run it on your own box) ─────────────────────────


def _serve(port: int) -> None:  # pragma: no cover — manual-run helper
    """Serve the relay from any machine with Python 3, no dependencies.
    Usage: python3 api/freedns.py [port]   (default port 8787)
    Then put http://<host>:<port>/api/freedns into the ⚡ FreeDNS panel."""
    import http.server

    class _Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 — stdlib interface
            from urllib.parse import parse_qs, urlparse

            qs = urlparse(self.path).query
            params = {k: v[0] for k, v in parse_qs(qs).items()}
            if params.get("kind", "").lower() == "webip":
                fwd = self.headers.get("x-forwarded-for", "")
                params["ip"] = str(fwd).split(",")[0].strip() or (self.client_address[0] or "")
            try:
                payload = handle_query(params)
                status = 200
            except Exception as exc:  # noqa: BLE001
                payload = {"error": f"{type(exc).__name__}: {exc}"}
                status = 502
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("access-control-allow-origin", "*")
            self.send_header("cache-control", "no-store")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args) -> None:  # type: ignore[no-untyped-def]
            pass  # keep the console clean

    srv = http.server.ThreadingHTTPServer(("0.0.0.0", port), _Handler)
    print(f"FreeDNS relay on http://0.0.0.0:{port}/api/freedns  (Ctrl-C to stop)")
    srv.serve_forever()


if __name__ == "__main__":  # pragma: no cover
    import sys

    _serve(int(sys.argv[1]) if len(sys.argv) > 1 else 8787)
