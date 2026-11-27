import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # read settings from the .env file (real environment variables take priority)

SECRET_KEY = os.getenv("SECRET_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# Raw TCP chat server (runs inside the same process as the web app)
TCP_HOST = os.getenv("TCP_HOST", "0.0.0.0")  # 0.0.0.0 = listen on every network interface
TCP_PORT = int(os.getenv("TCP_PORT", "5000"))

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()  # DEBUG also logs every TCP read and its frames
LOG_FILE = os.getenv("LOG_FILE", "logs/server.log")

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is missing from .env")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing from .env")


def setup_logging():
    """Connection/error log: printed to the console and kept in a rotating file."""
    log = logging.getLogger("conqchat")
    if log.handlers:  # already set up
        return log
    log.setLevel(LOG_LEVEL)
    log.propagate = False
    formatter = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s")
    Path(LOG_FILE).parent.mkdir(parents=True, exist_ok=True)
    for handler in (logging.StreamHandler(), RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=3)):
        handler.setFormatter(formatter)
        log.addHandler(handler)
    return log
