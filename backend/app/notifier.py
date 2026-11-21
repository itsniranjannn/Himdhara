"""Alert delivery by email (SMTP) with rich HTML templates and plain-text fallback,
with a persistent delivery log in the database.
"""
import logging
import smtplib
from email.message import EmailMessage
from typing import Optional

from sqlalchemy.orm import Session

from .config import settings
from .models import ContactModel, NotificationModel

logger = logging.getLogger("notifier")

RISK_NE = {"WARNING": "चेतावनी", "CRITICAL": "अति खतरा", "WATCH": "सर्तकता"}
_DEVANAGARI = str.maketrans("0123456789", "०१२३४५६७८९")


def build_message(alert: dict, language: str = "en") -> str:
    """Builds a plain-text fallback version of the alert email."""
    zone = alert.get("evacuation_zone") or ("नजिकको अग्लो सुरक्षित स्थान" if language == "ne" else "the nearest designated high ground")
    eta = alert.get("eta_minutes")
    eta_text = f"{eta:g}" if isinstance(eta, (int, float)) else str(eta)
    settlement = alert.get("affected_settlement_name", "")
    risk_level = alert.get("risk_level", "WARNING")
    station = alert.get("source_node_name", "River Gauge Station")

    if language == "ne":
        level = RISK_NE.get(risk_level, risk_level)
        return (
            f"⚠️ बाढी {level} सूचना — {settings.APP_NAME}\n\n"
            f"स्थान: {settlement}\n"
            f"जोखिम स्तर: {level}\n"
            f"अनुमानित समय (ETA): करिब {eta_text} मिनेट\n"
            f"सुरक्षित स्थान: {zone}\n"
            f"निगरानी केन्द्र: {station}\n\n"
            f"निर्देशन: तुरुन्तै सुरक्षित स्थान {zone} तर्फ जानुहोस्। बाढीको सतह नघटेसम्म खोला किनारमा नजानुहोला।"
        ).translate(_DEVANAGARI)

    return (
        f"⚠️ FLOOD {risk_level} ALERT — {settings.APP_NAME}\n\n"
        f"Target Settlement: {settlement}\n"
        f"Severity Level: {risk_level}\n"
        f"Estimated Flood Wave Arrival (ETA): ~{eta_text} minutes\n"
        f"Designated Safe Zone: {zone}\n"
        f"Triggering Station: {station}\n\n"
        f"Action Required: Immediately proceed toward {zone}. Stay away from riverbanks and low-lying floodplains."
    )


def build_subject(alert: dict, language: str = "en") -> str:
    name = alert.get("affected_settlement_name", "")
    risk_level = alert.get("risk_level", "WARNING")
    if language == "ne":
        return f"🚨 [{settings.APP_NAME}] बाढी {RISK_NE.get(risk_level, risk_level)}: {name}"
    return f"🚨 [{settings.APP_NAME}] Flood {risk_level} Warning: {name}"


def build_html_message(alert: dict, language: str = "en") -> str:
    """Renders a modern, responsive HTML alert email card."""
    zone = alert.get("evacuation_zone") or ("नजिकको अग्लो सुरक्षित स्थान" if language == "ne" else "Nearest Designated High Ground")
    eta = alert.get("eta_minutes")
    eta_text = f"{eta:g}" if isinstance(eta, (int, float)) else str(eta)
    settlement = alert.get("affected_settlement_name", "Settlement Area")
    risk_level = alert.get("risk_level", "WARNING").upper()
    station = alert.get("source_node_name", "Gauge Station")
    pop = alert.get("population_at_risk")
    pop_text = f"{pop:,}" if isinstance(pop, (int, float)) else (str(pop) if pop else "N/A")

    is_critical = risk_level == "CRITICAL"
    badge_bg = "#dc2626" if is_critical else "#d97706"
    badge_color = "#ffffff"
    border_accent = "#ef4444" if is_critical else "#f59e0b"

    if language == "ne":
        level_label = RISK_NE.get(risk_level, risk_level)
        eta_display = f"{eta_text} मिनेट".translate(_DEVANAGARI)
        pop_display = f"{pop_text}".translate(_DEVANAGARI)
        header_title = f"तत्काल बाढी {level_label} सूचना"
        instruction_text = (
            f"नदीको सतह खतराको विन्दु पार गरेको वा तीव्र गतिमा बढिरहेको पाइएको छ। "
            f"आफ्ना महत्त्वपूर्ण कागजात साथमा लिई तुरुन्तै <strong>{zone}</strong> तर्फ जानुहोला।"
        )
        labels = {
            "settlement": "प्रभावित बस्ती / क्षेत्र",
            "eta": "बाढी आइपुग्ने अनुमानित समय (ETA)",
            "safe_zone": "सुरक्षित आश्रय स्थल",
            "station": "पहिचान भएको जलमापन केन्द्र",
            "population": "जोखिममा रहेको जनसंख्या",
            "action_title": "तुरुन्त लिनुपर्ने सावधानी:",
            "action_1": "खोला तथा नदी किनारबाट तुरुन्त टाढा रहनुहोस्।",
            "action_2": "बालबालिका, वृद्ध तथा अशक्त व्यक्तिहरूलाई सुरक्षित स्थानमा पहिले लैजानुहोस्।",
            "action_3": "स्थानीय विपद् व्यवस्थापन र सुरक्षा निकायको निर्देशन पालना गर्नुहोस्।",
            "footer": "यो पूर्वसूचना हिमधारा (Himdhara) स्वचालित बाढी पूर्वसूचना प्रणालीबाट पठाइएको हो।"
        }
    else:
        level_label = risk_level
        eta_display = f"~{eta_text} Minutes"
        pop_display = pop_text
        header_title = f"IMMEDIATE FLOOD {level_label} ALERT"
        instruction_text = (
            f"Upstream river gauges indicate a dangerous surge wave traveling downstream. "
            f"Please evacuate vulnerable riverbanks and relocate to <strong>{zone}</strong> immediately."
        )
        labels = {
            "settlement": "Target Settlement",
            "eta": "Estimated Time of Arrival (ETA)",
            "safe_zone": "Designated Evacuation Shelter",
            "station": "Origin Gauge Station",
            "population": "Population in Impact Zone",
            "action_title": "Urgent Instructions & Safety Checklist:",
            "action_1": "Move away from river embankments and low bridges immediately.",
            "action_2": "Help children, elders, and pets move to designated high ground first.",
            "action_3": "Keep emergency contacts ready and tune in to local administrative updates.",
            "footer": "Automated alert issued by Himdhara Real-Time River Early Warning System."
        }

    return f"""<!DOCTYPE html>
<html lang="{language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{header_title}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 18px rgba(0,0,0,0.08); border-top: 6px solid {border_accent};">
    
    <!-- Header -->
    <div style="padding: 24px 28px 16px; background: #0f172a; color: #ffffff;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <div style="font-size: 13px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #94a3b8;">
              HIMDHARA EARLY WARNING
            </div>
            <h1 style="margin: 6px 0 0; font-size: 21px; font-weight: 800; color: #ffffff; letter-spacing: -0.2px;">
              {header_title}
            </h1>
          </td>
          <td align="right" valign="top">
            <span style="display: inline-block; padding: 6px 14px; font-size: 13px; font-weight: 800; border-radius: 9999px; background-color: {badge_bg}; color: {badge_color}; text-transform: uppercase; letter-spacing: 0.5px;">
              {level_label}
            </span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Alert Overview Callout -->
    <div style="padding: 18px 28px; background: #fef2f2; border-bottom: 1px solid #fee2e2;">
      <p style="margin: 0; font-size: 15px; line-height: 1.55; color: #991b1b;">
        {instruction_text}
      </p>
    </div>

    <!-- Key Metrics Grid -->
    <div style="padding: 24px 28px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 20px;">
        <tr>
          <td width="50%" style="padding: 10px 14px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px;">{labels['settlement']}</div>
            <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-top: 4px;">{settlement}</div>
          </td>
          <td width="10"></td>
          <td width="50%" style="padding: 10px 14px; background: #fef3c7; border-radius: 8px; border: 1px solid #fde68a;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #b45309; letter-spacing: 0.5px;">{labels['eta']}</div>
            <div style="font-size: 18px; font-weight: 900; color: #92400e; margin-top: 4px;">{eta_display}</div>
          </td>
        </tr>
        <tr><td height="10" colspan="3"></td></tr>
        <tr>
          <td width="50%" style="padding: 10px 14px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px;">{labels['safe_zone']}</div>
            <div style="font-size: 15px; font-weight: 700; color: #166534; margin-top: 4px;">🛡️ {zone}</div>
          </td>
          <td width="10"></td>
          <td width="50%" style="padding: 10px 14px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px;">{labels['population']}</div>
            <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 4px;">👥 {pop_display}</div>
          </td>
        </tr>
      </table>

      <!-- Instructions List -->
      <div style="margin-top: 20px; padding: 18px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
        <div style="font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 10px;">
          {labels['action_title']}
        </div>
        <ul style="margin: 0; padding-left: 20px; font-size: 13.5px; line-height: 1.6; color: #334155;">
          <li style="margin-bottom: 6px;">{labels['action_1']}</li>
          <li style="margin-bottom: 6px;">{labels['action_2']}</li>
          <li>{labels['action_3']}</li>
        </ul>
      </div>

      <!-- Monitoring Station Info -->
      <div style="margin-top: 18px; font-size: 12px; color: #64748b;">
        📡 <strong>{labels['station']}:</strong> {station}
      </div>
    </div>

    <!-- Footer -->
    <div style="padding: 18px 28px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5;">
      <div>{labels['footer']}</div>
      <div style="margin-top: 4px; font-size: 11px;">Autonomous Multi-Basin Hydrodynamic Telemetry & Hazard Dispatch</div>
    </div>

  </div>
</body>
</html>
"""


class Notifier:
    """Sends email through the configured provider and records the outcome."""

    def send_email(self, address: str, subject: str, text: str, html: Optional[str] = None) -> tuple[str, Optional[str]]:
        if settings.EMAIL_PROVIDER == "smtp":
            if not (settings.SMTP_HOST and settings.SMTP_FROM):
                return "FAILED", "SMTP_HOST / SMTP_FROM not configured"
            try:
                message = EmailMessage()
                message["Subject"] = subject
                message["From"] = f"{settings.APP_NAME} Alerts <{settings.SMTP_FROM}>"
                message["To"] = address
                # Set plain-text fallback
                message.set_content(text)
                # Add rich HTML alternative if provided
                if html:
                    message.add_alternative(html, subtype="html")

                with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=12) as smtp:
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
            ContactModel.settlement_id == alert["affected_settlement_id"],
            ContactModel.active.is_(True),
            ContactModel.email.isnot(None),
        ).all()
        count = 0

        def record(recipient: str, subject: str, content: str, status: str, error: Optional[str]) -> None:
            nonlocal count
            db.add(NotificationModel(
                alert_id=alert.get("alert_id"),
                channel="email",
                provider=settings.EMAIL_PROVIDER,
                recipient=recipient,
                content=f"{subject}\n\n{content}",
                status=status,
                error=error,
            ))
            count += 1

        if not contacts:
            record(
                f"settlement:{alert['affected_settlement_id']}",
                build_subject(alert),
                build_message(alert),
                "SIMULATED",
                "No contacts registered",
            )
        for contact in contacts:
            language = contact.language or "en"
            text = build_message(alert, language)
            html = build_html_message(alert, language)
            subject = build_subject(alert, language)
            status, err = self.send_email(contact.email, subject, text, html)
            record(contact.email, subject, text, status, err)

        db.commit()
        return count


notifier = Notifier()
