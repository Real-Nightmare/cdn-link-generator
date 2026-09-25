// Probe 3: dynamic-DNS update endpoint shapes + CORS headers.
// Fake credentials on purpose — we only care about endpoint existence,
// response text format, and whether Access-Control-Allow-Origin is sent
// (decides client-side vs relay op).
const targets = [
  { name: "duckdns", url: "https://www.duckdns.org/update?domains=probe&token=fake&ip=203.0.113.7" },
  { name: "dynv6", url: "https://dynv6.com/api/update?hostname=probe.dynv6.net&token=fake&ipv4=203.0.113.7" },
  { name: "dynu", url: "https://api.dynu.com/nic/update?hostname=probe.dynu.net&myip=203.0.113.7" },
  { name: "noip", url: "https://dynupdate.no-ip.com/nic/update?hostname=probe.ddns.net&myip=203.0.113.7" },
  { name: "changeip", url: "https://nic.changeip.com/nic/update?u=fake&p=fake&hostname=probe&myip=203.0.113.7" },
  { name: "cloudns", url: "https://api.cloudns.net/dyn/update/?auth-id=0&auth-password=fake&domain=probe.cloudns.nz&host=www&ip=203.0.113.7" },
];

for (const t of targets) {
  try {
    const res = await fetch(t.url, {
      headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/102.0" },
    });
    const cors = res.headers.get("access-control-allow-origin");
    const body = (await res.text()).slice(0, 120).replace(/\s+/g, " ");
    console.log(`${t.name}: HTTP ${res.status} cors=${cors ?? "—"} body="${body}"`);
  } catch (e) {
    console.log(`${t.name}: ERROR ${e.message}`);
  }
}

// sslip.io sanity: does 203.0.113.7.sslip.io resolve pattern hold (just check A via their http)? 
try {
  const res = await fetch("https://203.0.113.7.sslip.io/", { redirect: "manual" });
  console.log(`sslip probe: HTTP ${res.status} (any response = wildcard live)`);
} catch (e) {
  console.log(`sslip probe: ${e.message} (expected — .7 serves nothing, but DNS+TLS endpoint responded)`);
}
