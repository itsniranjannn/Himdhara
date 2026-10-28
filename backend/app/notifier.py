"""Alert delivery: SMS (Sparrow SMS) and email (SMTP), with a persistent delivery log.

With the default `simulated` providers nothing leaves the machine; every message
is still recorded in the `notifications` table so the full flow can be demoed.
"""
import json
import logging
import smtplib
import urllib.parse
import urllib.request
from email.message import EmailMessage
from typing import Optional

from sqlalchemy.orm import Session

from .config import settings
from .models import ContactModel, NotificationModel

logger = logging.getLogger("notifier")

RISK_NE = {"WARNING": "चेतावनी", "CRITICAL": "अति खतरा"}
_DEVANAGARI = str.maketrans("0123456789", "०१२३४५६७८९")


def build_message(alert: dict, language: str = "en") -> str:
    zone = alert.get("evacuation_zone") or ("नजिकको अग्लो सुरक्षित स्थान" if language == "ne" else "the nearest high ground")
    eta = alert.get("eta_minutes")
    eta_text = f"{eta:g}" if isinstance(eta, (int, float)) else str(eta)
    if language == "ne":
        level = RISK_NE.get(alert.get("risk_level"), alert.get("risk_level", ""))
        return f"बाढी {level}: {alert['affected_settlement_name']}। लहर पुग्न करिब {eta_text} मिनेट। तुरुन्तै {zone} तिर जानुहोस्।".translate(_DEVANAGARI)
    return f"FLOOD {alert.get('risk_level')}: {alert['affected_settlement_name']}. Flood wave ETA {eta_text} min. Move to {zone} now."


class Notifier:
    """Sends via the configured provider and records the outcome."""

    def send_sms(self, phone: str, text: str) -> tuple[str, Optional[str]]:
        if settings.SMS_PROVIDER == "sparrow":
            if not (settings.SPARROW_TOKEN and settings.SPARROW_FROM):
                return "FAILED", "SPARROW_TOKEN / SPARROW_FROM not configured"
            try:
                body = urllib.parse.urlencode({"token": settings.SPARROW_TOKEN, "from": settings.SPARROW_FROM, "to": phone, "text": text}).encode()
                with urllib.request.urlopen(urllib.request.Request("https://api.sparrowsms.com/v2/sms/", data=body), timeout=10) as response:
                    result = json.loads(response.read().decode() or "{}")
                if result.get("response_code") == 200:
                    return "SENT", None
                return "FAILED", str(result)[:300]
            except Exception as error:
                return "FAILED", str(error)[:300]
        return "SIMULATED", None

    def send_email(self, address: str, subject: str, text: str) -> tuple[str, Optional[str]]:
        if settings.EMAIL_PROVIDER == "smtp":
            if not (settings.SMTP_HOST and settings.SMTP_FROM):
                return "FAILED", "SMTP_HOST / SMTP_FROM not configured"
            try:
                message = EmailMessage()
                message["Subject"], message["From"], message["To"] = subject, settings.SMTP_FROM, address
                message.set_content(text)
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
                    smtp.starttls()
                    if settings.SMTP_USERNAME:
                        smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                    smtp.send_message(message)
                return "SENT", None
            except Exception as error:
                return "FAILED", str(error)[:300]
        return "SIMULATED", None

    def notify_alert(self, db: Session, alert: dict) -> int:
        """Deliver one alert to every active contact of its settlement. Returns messages logged."""
        provider = {"sms": settings.SMS_PROVIDER, "email": settings.EMAIL_PROVIDER}
        contacts = db.query(ContactModel).filter(
            ContactModel.settlement_id == alert["affected_settlement_id"], ContactModel.active.is_(True)).all()
        count = 0

        def record(channel: str, recipient: str, content: str, status: str, error: Optional[str]) -> None:
            nonlocal count
            db.add(NotificationModel(alert_id=alert.get("alert_id"), channel=channel, provider=provider[channel],
                                     recipient=recipient, content=content, status=status, error=error))
            count += 1

        if not contacts:
            # Nobody has registered for this settlement: keep a record so operators can see the gap.
            record("sms", f"settlement:{alert['affected_settlement_id']}", build_message(alert), "SIMULATED", "No contacts registered")
        for contact in contacts:
            text = build_message(alert, contact.language or "en")
            if contact.phone:
                record("sms", contact.phone, text, *self.send_sms(contact.phone, text))
            if contact.email:
                record("email", contact.email, text, *self.send_email(contact.email, f"{alert['risk_level']} flood alert", text))
        db.commit()
        return count


notifier = Notifier()
