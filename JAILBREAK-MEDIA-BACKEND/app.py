import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

import config
from downloaders import downloaders

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("jailbreak-media-backend")

app = FastAPI(title="JAILBREAK MEDIA BACKEND", version="1.0.0")


@app.middleware("http")
async def auth_and_log(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path != "/api/health" and config.TOKEN:
        auth = request.headers.get("authorization", "")
        if auth != f"Bearer {config.TOKEN}":
            return JSONResponse({"ok": False, "error": "Unauthorized"}, status_code=401)
    response = await call_next(request)
    if config.LOG_REQUEST:
        logger.info("%s %s -> %s", request.method, path, response.status_code)
    return response


@app.get("/api/health")
def health():
    return {"ok": True, "service": "jailbreak-media-backend", "platforms": list(downloaders)}


@app.api_route("/api/download/{platform}", methods=["GET", "POST"])
async def download(platform: str, request: Request, url: str = None):
    platform = (platform or "").lower().strip()
    if not url:
        url = request.query_params.get("url") or await _form_body_url(request)
    url = (url or "").strip()

    if not platform:
        return JSONResponse({"ok": False, "error": "Missing platform"}, status_code=400)
    if not url:
        return JSONResponse({"ok": False, "error": "url must be an http(s) link"}, status_code=400)
    if not url.startswith(("http://", "https://")):
        return JSONResponse({"ok": False, "error": "url must be an http(s) link"}, status_code=400)

    fn = downloaders.get(platform)
    if not fn:
        supported = ", ".join(downloaders)
        return JSONResponse(
            {"ok": False, "error": f"Unsupported platform: {platform}. Supported: {supported}"},
            status_code=404,
        )

    try:
        items = await run_in_threadpool(fn, url)
        return {"ok": True, "platform": platform, "data": items}
    except Exception as e:  # noqa: BLE001
        logger.warning("download %s failed: %s", platform, e)
        return JSONResponse({"ok": False, "platform": platform, "error": str(e)}, status_code=502)


async def _form_body_url(request: Request):
    try:
        body = await request.json()
        return body.get("url")
    except Exception:  # noqa: BLE001
        return None