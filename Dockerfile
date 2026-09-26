# The FreeDNS relay, packaged for always-on free hosts (Koyeb, Fly.io, …).
# Deploy: create a web service from this repo — the host builds this image and
# gives you https://<app>.<host> with HTTPS + health checks. The relay answers
# on $PORT (or 8787) and replies 200 on "/" for platform health probes.
# Zero pip dependencies — stdlib only.
FROM python:3.11-slim

WORKDIR /app
COPY api/freedns.py ./freedns.py

ENV PORT=8787
EXPOSE 8787
CMD ["python", "freedns.py"]
