"""Offline checks for api/freedns.py changes: registry parsing (incl. <font>
search rows), least-popular paging math, dyndns op validation. No network."""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("freedns", "api/freedns.py")
fd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fd)

# ── registry parsing: normal row ─────────────────────────────────────────────
NORMAL = (
    '<tr class="trl"><td><a href=/subdomain/edit.php?edit_domain_id=29>mooo.com</a>'
    '<br><span> (870,034 hosts in use) <a target=_blank href=http://www.mooo.com/>website</a></span></td>'
    "<td>public</td><td><a href=/tools/contact.php?user_id=1&subject=mooo.com>josh</a></td>"
    "<td>9325 days ago (03/15/2001)</td></tr>"
)
# ── registry parsing: q= search row with <font color=red> inside the anchor ──
SEARCH = (
    '<tr class="trl"><td><a href=/subdomain/edit.php?edit_domain_id=29><font color=red>mooo</font>.com</a>'
    '<br><span> (870094 hosts in use) <a target=_blank rel="nofollow" href=http://www.mooo.com/>website</a></span></td>'
    "<td>public</td><td><a href=/tools/contact.php?user_id=1&subject=mooo.com>josh</a></td>"
    "<td>9325 days ago (03/15/2001)</td></tr>"
)
PAGE = "<html>Showing <b>1</b>-<b>2</b> of <b>21,363</b> total<table>" + NORMAL + SEARCH + "</table></html>"

r = fd._parse_registry(PAGE)
assert r["total"] == 21363, r["total"]
assert r["pages"] == 214, r["pages"]
assert [d["domain"] for d in r["domains"]] == ["mooo.com", "mooo.com"], r["domains"]
assert [d["id"] for d in r["domains"]] == [29, 29]
assert [d["hosts"] for d in r["domains"]] == [870034, 870094]
assert all(d["status"] == "public" for d in r["domains"])
print("registry parse: OK (normal + <font> search rows, 2 rows, names clean)")

# ── least-popular paging math (mirror of Session.registry) ───────────────────
pages = 214
for ui_page, expect in [(1, 214), (2, 213), (5, 210), (214, 1), (999, 1)]:
    target = max(1, pages - ui_page + 1)
    assert target == expect, (ui_page, target)
print("least-popular paging math: OK (page 1 -> registry page 214)")

# ── dyndns op validation (no network: unknown provider + missing args) ───────
try:
    fd.handle_query({"kind": "dyndns", "provider": "nope", "host": "x", "ip": "1.2.3.4"})
    raise AssertionError("unknown provider accepted")
except fd.FreednsError as e:
    assert "provider must be" in str(e), e
try:
    fd.handle_query({"kind": "dyndns", "provider": "duckdns", "host": "", "ip": "1.2.3.4"})
    raise AssertionError("empty host accepted")
except fd.FreednsError:
    pass
print("dyndns validation: OK")

# ── registry op param handling (needs no network for bad sid) ────────────────
try:
    fd.handle_query({"kind": "registry"})  # no sid
    raise AssertionError("missing sid accepted")
except fd.FreednsError as e:
    assert "login first" in str(e), e
print("registry op validation: OK")

# ── Session.registry least-mode mapping, offline via a stubbed session ──────
class FakeSession:
    _reg_totals = {}
    def get(self, url, extra=None):
        FakeSession.last_url = url
        if "page=1&" in url:
            return 200, PAGE
        return 200, PAGE
    registry = fd.Session.registry

fs = FakeSession()
out = fs.registry(page=1, least=True)
assert "page=214&" in FakeSession.last_url, FakeSession.last_url
assert out["page"] == 214 and out["least"] is True and out["total"] == 21363
out2 = fs.registry(page=2, least=True)
assert "page=213&" in FakeSession.last_url, FakeSession.last_url
assert fs._reg_totals[""], "total cache not populated"
out3 = fs.registry(page=1, query="mooo", least=True)  # separate cache entry
assert "q=mooo" in FakeSession.last_url, FakeSession.last_url
assert "page=214&" in FakeSession.last_url
print("Session.registry least-mode: OK (tail mapping, q= carried, cache per query)")

print("ALL RELAY CHECKS PASSED")
