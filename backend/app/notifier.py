import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from .config import settings

logger = logging.getLogger("notifier")
class Notifier(ABC):
    @abstractmethod
    def send_sms(self, recipient: str, message: str) -> None: ...
    @abstractmethod
    def send_email(self, recipient: str, subject: str, body: str) -> None: ...

class SimulatedNotifier(Notifier):
    def __init__(self):
        self.logs = []
    def _log(self, channel, recipient, content):
        entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "channel": channel,
                 "provider": getattr(settings, f"{channel.upper()}_PROVIDER"), "recipient": recipient,
                 "content": content}
        self.logs.append(entry)
        logger.info("simulated notification: %s", entry)
    def send_sms(self, recipient, message): self._log("sms", recipient, message)
    def send_email(self, recipient, subject, body): self._log("email", recipient, f"{subject}: {body}")

notifier = SimulatedNotifier()
