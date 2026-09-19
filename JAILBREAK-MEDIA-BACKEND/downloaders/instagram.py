import re

import config
from . import _http, _ytdlp


def _imginn_scrape(url):
    """Provider 2: imginn.com scraper (no auth needed)."""
    m = re.search(r"instagram\.com/(?:p|reel|tv)/([a-zA-Z0-9_-]+)", url) or \
        re.search(r"instagr\.am/([a-zA-Z0-9_-]+)", url)
    if not m:
        raise ValueError("Could not extract shortcode from URL")
    shortcode = m.group(1)

    html = _http.get_text(f"https://imginn.com/p/{shortcode}/")
    items = []
    seen = set()

    for u in re.findall(r"https://s\d+\.imginn\.com/[^\"']+\.jpg[^\"']*", html):
        if u not in seen:
            seen.add(u)
            items.append({"url": u, "type": "image", "thumbnail": True})

    for u in re.findall(r"https://[^\"']+\.mp4[^\"']*", html):
        if u not in seen:
            seen.add(u)
            items.append({"url": u, "type": "video", "thumbnail": False})

    for mtag in re.findall(r'<meta[^>]+property="og:video[^"]*"[^>]+content="([^"]+)"', html):
        if mtag not in seen:
            seen.add(mtag)
            items.append({"url": mtag, "type": "video", "thumbnail": False})

    if not items:
        title_m = re.search(r"<title>(.*?)</title>", html)
        title = title_m.group(1) if title_m else ""
        if "not found" in title.lower() or "404" in title:
            raise ValueError("Post not found on imginn.com")
        raise ValueError("No media found on imginn.com")
    return items


def _siputz_ig(url):
    """Provider 3: siputzx public API."""
    data = _http.get_json("https://api.siputzx.my.id/api/d/igdl", params={"url": url})
    items = []
    for m in data.get("data") or []:
        u = m.get("url") or m.get("download_url")
        if not u:
            continue
        is_video = m.get("type") == "video" or u.endswith(".mp4")
        items.append({"url": u, "type": "video" if is_video else "image",
                      "thumbnail": not is_video})
    if not items:
        raise ValueError("siputzx returned no media")
    return items


def _instagapi(url):
    """Provider 4: InstaGapi (optional, needs INSTAGAPI_KEY)."""
    api_key = config.INSTAGAPI_KEY
    if not api_key:
        raise ValueError("InstaGapi API key not configured")

    m = re.search(r"instagram\.com/(?:p|reel|tv)/([a-zA-Z0-9_-]+)", url)
    if not m:
        raise ValueError("Could not extract shortcode from URL")
    shortcode = m.group(1)

    last_error = None
    for endpoint in (
        f"https://api.instagapi.com/v1/media/{shortcode}?access_key={api_key}",
        f"https://api.instagapi.com/media/{shortcode}?access_key={api_key}",
        f"https://api.instagapi.com/v1/media/{shortcode}?api_key={api_key}",
    ):
        try:
            data = _http.get_json(endpoint)
            items = []

            media_url = (data.get("url") or data.get("download_url")
                         or (data.get("data") or {}).get("url")
                         or (data.get("data") or {}).get("download_url"))
            mtype = data.get("type") or (data.get("data") or {}).get("type") or ""

            if media_url:
                is_video = mtype == "video" or media_url.endswith(".mp4")
                items.append({"url": media_url, "type": "video" if is_video else "image",
                              "thumbnail": not is_video})

            carousel = (data.get("data") or {}).get("carousel_media") or data.get("carousel_media") or []
            for cm in carousel:
                cu = (cm.get("url") or cm.get("download_url") or cm.get("media_url")
                      or (cm.get("image_versions2") or {}).get("candidates") or [])
                if isinstance(cu, list):
                    cu = cu[0].get("url") if cu and cu[0] else None
                if cu:
                    is_video = cm.get("media_type") == 2 or cu.endswith(".mp4")
                    items.append({"url": cu, "type": "video" if is_video else "image",
                                  "thumbnail": not is_video})

            if items:
                return items
            last_error = ValueError("InstaGapi returned no media")
        except Exception as e:  # noqa: BLE001
            last_error = e
    raise last_error or ValueError("InstaGapi failed")


def download(url):
    """Instagram fallback chain: yt-dlp -> imginn -> siputzx -> InstaGapi."""
    errors = []

    try:
        items = _ytdlp.entries_to_items(_ytdlp.ydl_info(url))
        if items:
            video = next((i for i in items if i["type"] == "video"), None)
            image = next((i for i in items if i["type"] == "image"), None)
            return [video, image] if (video and image) else items
    except Exception as e:  # noqa: BLE001
        errors.append(f"yt-dlp: {e}")

    try:
        items = _imginn_scrape(url)
        if items:
            video = next((i for i in items if i["type"] == "video"), None)
            image = next((i for i in items if i["type"] == "image"), None)
            return [video, image] if (video and image) else items
    except Exception as e:  # noqa: BLE001
        errors.append(f"imginn: {e}")

    try:
        items = _siputz_ig(url)
        if items:
            return items
    except Exception as e:  # noqa: BLE001
        errors.append(f"siputzx: {e}")

    if config.INSTAGAPI_KEY:
        try:
            items = _instagapi(url)
            if items:
                return items
        except Exception as e:  # noqa: BLE001
            errors.append(f"instagapi: {e}")

    hint = "" if config.INSTAGAPI_KEY else \
        " Set INSTAGAPI_KEY on the backend to add an extra fallback (30 free req/mo at instagapi.com)."
    raise ValueError(
        f"Instagram download failed. Tried: {'; '.join(errors)}.{hint}"
    )