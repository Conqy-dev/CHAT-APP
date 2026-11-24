import os

from dotenv import load_dotenv

load_dotenv()  # read settings from the .env file

SECRET_KEY = os.getenv("SECRET_KEY")
DATABASE_URL = os.getenv("DATABASE_URL")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is missing from .env")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is missing from .env")
