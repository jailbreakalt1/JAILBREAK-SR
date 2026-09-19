import os

USER_AGENT = os.getenv(
    "USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
)

# Optional bearer token — the bot must send `Authorization: Bearer <token>`.
TOKEN = os.getenv("MEDIA_BACKEND_TOKEN", "")

# Optional Instagram last-resort fallback (30 free req/mo at instagapi.com).
INSTAGAPI_KEY = os.getenv("INSTAGAPI_KEY", "")

# Log every request to stdout (Render logs).
LOG_REQUEST = os.getenv("LOG_REQUEST", "0") == "1"

# Per-provider HTTP/network timeout in seconds.
NETWORK_TIMEOUT = float(os.getenv("NETWORK_TIMEOUT", "25"))

# cookies.txt at the backend root is passed to yt-dlp (helps Instagram/Facebook).
COOKIES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")
