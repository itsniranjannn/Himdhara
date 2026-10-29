"""Alert delivery by email (SMTP), with a persistent delivery log.

Email is the only channel: it is free, works with any provider (for example a Gmail
app password) and needs no paid gateway. With the default `simulated` provider nothing
leaves the machine; every message is still recorded in the `notifications` table so
the whole flow can be demonstrated.
"""
import logging
import smtplib
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


def build_subject(alert: dict, language: str = "en") -> str:
    name = alert.get("affected_settlement_name", "")
    if language == "ne":
        return f"[{settings.APP_NAME}] बाढी {RISK_NE.get(alert.get('risk_level'), alert.get('risk_level', ''))}: {name}"
    return f"[{settings.APP_NAME}] Flood {alert.get('risk_level')}: {name}"


class Notifier:
    """Sends email through the configured provider and records the outcome."""

    def send_email(self, address: str, subject: str, text: str) -> tuple[str, Optional[str]]:
        if settings.EMAIL_PROVIDER == "smtp":
            if not (settings.SMTP_HOST and settings.SMTP_FROM):
                return "FAILED", "SMTP_HOST / SMTP_FROM not configured"
            try:
                message = EmailMessage()
                message["Subject"], message["From"], message["To"] = subject, settings.SMTP_FROM, address
                message.set_content(text)
                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
                    if settings.SMTP_STARTTLS:
                        smtp.starttls()
                    if settings.SMTP_USERNAME:
                        smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                    smtp.send_message(message)
                return "SENT", None
            except Exception as error:
                return "FAILED", str(error).replace(settings.SMTP_PASSWORD or "\0", "***")[:300]
        return "SIMULATED", None

    def notify_alert(self, db: Session, alert: dict) -> int:
        """Email one alert to every active contact of its settlement. Returns messages logged."""
        contacts = db.query(ContactModel).filter(
            ContactModel.settlement_id == alert["affected_settlement_id"], ContactModel.active.is_(True),
            ContactModel.email.isnot(None)).all()
        count = 0

        def record(recipient: str, subject: str, content: str, status: str, error: Optional[str]) -> None:
            nonlocal count
            db.add(NotificationModel(alert_id=alert.get("alert_id"), channel="email", provider=settings.EMAIL_PROVIDER,
                                     recipient=recipient, content=f"{subject}\n\n{content}", status=status, error=error))
            count += 1

        if not contacts:
            # Nobody has registered for this settlement: keep a record so operators can see the gap.
            record(f"settlement:{alert['affected_settlement_id']}", build_subject(alert), build_message(alert), "SIMULATED", "No contacts registered")
        for contact in contacts:
            language = contact.language or "en"
            text = build_message(alert, language)
            subject = build_subject(alert, language)
            record(contact.email, subject, text, *self.send_email(contact.email, subject, text))
        db.commit()
        return count


notifier = Notifier()
