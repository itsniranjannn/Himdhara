"""Live email demo against a RUNNING backend and simulator (not collected by pytest).

    1. In .env set:  EMAIL_PROVIDER=smtp  SMTP_HOST=127.0.0.1  SMTP_PORT=2526  SMTP_STARTTLS=false  SMTP_FROM=alerts@himdhara.local
    2. Restart the backend, then run:  python backend/tests/demo_email_live.py

The script starts a throw-away SMTP server on 127.0.0.1:2526, registers an English and a Nepali contact for every
settlement, injects a flood spike in every basin, and then checks that each alerted settlement's contacts really
received the email (right language, right settlement) and that nobody outside the alerted settlements did.
It removes its contacts and resets the simulation afterwards. Exits non-zero on any failure.
"""
import email
import json
import os
import sys
import time
import urllib.error
import urllib.request
from email.header import decode_header, make_header

from aiosmtpd.controller import Controller

BASE = os.getenv("EWS_API", "http://127.0.0.1:8000/api")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
inbox, failures = [], []


class Sink:
    async def handle_DATA(self, server, session, envelope):
        message = email.message_from_bytes(envelope.content)
        subject = str(make_header(decode_header(message["Subject"])))
        body = message.get_payload(decode=True).decode(message.get_content_charset() or "utf-8")
        for recipient in envelope.rcpt_tos:
            inbox.append({"to": recipient, "subject": subject, "body": body})
        return "250 OK"


def env_value(key):
    for line in open(os.path.join(ROOT, ".env"), encoding="utf-8"):
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return ""


def call(path, method="GET", body=None, token=None):
    request = urllib.request.Request(f"{BASE}{path}", method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read().decode() or "null")
    except urllib.error.HTTPError as error:
        return error.code, None


def check(name, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}  {name}{('  ' + str(detail)) if detail and not condition else ''}")
    if not condition:
        failures.append(name)


def main():
    status, health = call("/health")
    check("backend online with SMTP email", status == 200 and health["email_provider"] == "smtp", health)
    if failures:
        sys.exit(1)
    controller = Controller(Sink(), hostname="127.0.0.1", port=2526)
    controller.start()
    token = call("/auth/login", "POST", {"username": env_value("DEFAULT_OPERATOR_USERNAME") or "operator", "password": env_value("DEFAULT_OPERATOR_PASSWORD")})[1]["access_token"]
    call("/simulation/reset", "POST", token=token)
    time.sleep(6)

    basins = call("/basins")[1]
    settlements = call("/settlements")[1]
    nodes = call("/nodes")[1]
    created = []
    for s in settlements:
        for lang, tag in (("en", "en"), ("ne", "ne")):
            address = f"{s['settlement_id'].lower()}.{tag}@demo.himdhara.test"
            status, row = call("/contacts", "POST", {"settlement_id": s["settlement_id"], "name": f"Demo {tag}", "email": address, "language": lang}, token)
            if status == 201:
                created.append(row["id"])
    check(f"{len(settlements) * 2} demo contacts registered", len(created) == len(settlements) * 2, len(created))

    first = {}
    for n in nodes:
        first.setdefault(n["basin_id"], n["node_id"])
    for b in basins:
        check(f"spike accepted in {b['basin_id']}", call("/spike/inject", "POST", {"node_id": first[b["basin_id"]], "water_level_surge_cm": 180}, token)[0] == 200)
    print("waiting 30 s for the surge to propagate and emails to be delivered...")
    time.sleep(30)

    alerts = call("/alerts?active_only=true&limit=500")[1]
    alerted = {a["affected_settlement_id"]: a for a in alerts}
    check("alerts raised in every basin", {a["basin_id"] for a in alerts} >= {b["basin_id"] for b in basins}, sorted({a["basin_id"] for a in alerts}))

    for b in basins:
        mine = [a for a in alerts if a["basin_id"] == b["basin_id"]]
        got = 0
        for a in mine:
            sid = a["affected_settlement_id"].lower()
            en = [m for m in inbox if m["to"] == f"{sid}.en@demo.himdhara.test" and a["affected_settlement_name"] in m["subject"]]
            ne = [m for m in inbox if m["to"] == f"{sid}.ne@demo.himdhara.test" and a["affected_settlement_name"] in m["subject"]]
            ok = bool(en) and bool(ne) and "Flood" in en[0]["subject"] and any("ऀ" <= ch <= "ॿ" for ch in ne[0]["body"]) and "Move to" in en[0]["body"]
            got += ok
        check(f"{b['basin_id']}: all {len(mine)} alerted settlements emailed in English and Nepali", mine and got == len(mine), f"{got}/{len(mine)}")

    stray = [m for m in inbox if not any(m["to"].startswith(sid.lower() + ".") for sid in alerted)]
    check("no email to a settlement that was not alerted", not stray, [m["to"] for m in stray][:3])

    _, log = call("/notifications/log?limit=500", token=token)
    demo = [r for r in log if r["recipient"].endswith("@demo.himdhara.test")]
    check("delivery log shows every email as SENT", demo and all(r["status"] == "SENT" and r["channel"] == "email" for r in demo), {r["status"] for r in demo})

    print(f"\nSample email -> {inbox[0]['to']}\n  Subject: {inbox[0]['subject']}\n  Body:    {inbox[0]['body'].strip()}" if inbox else "\nNo emails received")
    ne_sample = next((m for m in inbox if ".ne@" in m["to"]), None)
    if ne_sample:
        print(f"\nSample Nepali email -> {ne_sample['to']}\n  Subject: {ne_sample['subject']}\n  Body:    {ne_sample['body'].strip()}")
    print(f"\nTotal emails delivered: {len(inbox)} to {len({m['to'] for m in inbox})} addresses")

    for cid in created:
        call(f"/contacts/{cid}", "DELETE", token=token)
    call("/simulation/reset", "POST", token=token)
    controller.stop()
    print("\nALL CHECKS PASSED" if not failures else f"\n{len(failures)} CHECK(S) FAILED: {failures}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
