import re

from . import _http, _ytdlp


def _collect_urls(data):
    urls = []
    if isinstance(data.get("urls"), list):
        urls.extend(u for u in data["urls"] if isinstance(u, str))
    for key in ("video_url", "download_url", "url", "play"):
        if data.get(key):
            urls.append(data[key])
    for key in ("no_watermark", "watermark"):
        child = data.get(key) or {}
        if isinstance(child, dict) and child.get("download_url"):
            urls.append(child["download_url"])
    return list(dict.fromkeys(u for u in urls if u.startswith(("http://", "https://"))))


def _siputz_tik(url):
    """Provider 2: siputzx public API."""
    data = _http.get_json("https://api.siputzx.my.id/api/d/tiktok", params={"url": url})
    items = []
    seen = set()

    for u in _collect_urls(data.get("data") or {}):
        if u not in seen:
            seen.add(u)
            items.append({"url": u, "type": "video", "thumbnail": False})

    thumb = None
    meta = (data.get("data") or {}).get("metadata") or {}
    for key in ("cover", "thumbnail", "image_url"):
        if meta.get(key):
            thumb = meta[key]
            break
    if thumb and thumb.startswith("http") and thumb not in seen:
        items.append({"url": thumb, "type": "image", "thumbnail": True})

    if not items:
        raise ValueError("siputzx returned no video")
    return items


def _tiktok_page_scrape(url):
    """Provider 2: sniff the public TikTok page for the direct video URL."""
    html = _http.get_text(url, headers={
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.tiktok.com/",
    })
    items = []
    seen = set()

    def push(raw):
        u = (raw or "").replace("\\u002F", "/").replace("\\u003D", "=").replace("\\u0026", "&").replace('\\"', '"')
        if u.startswith(("http://", "https://")) and u not in seen:
            seen.add(u)
            items.append({"url": u, "type": "video", "thumbnail": False})

    for m in re.finditer(r'"(?:playAddr|playUrl|downloadAddr|video_url)"\s*:\s*"([^"]+)"', html):
        push(m.group(1))

    for m in re.finditer(r'<meta[^>]+property="og:video(?::url)?"[^>]+content="([^"]+)"', html):
        push(m.group(1))

    og_img = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html)
    if og_img and og_img.group(1).startswith("http"):
        items.append({"url": og_img.group(1), "type": "image", "thumbnail": True})

    if not items:
        raise ValueError("No media found on TikTok page")
    return items


def download(url):
    """TikTok fallback chain: yt-dlp -> siputzx -> page sniff."""
    errors = []

    try:
        items = _ytdlp.entries_to_items(_ytdlp.ydl_info(url))
        if items:
            return items
    except Exception as e:  # noqa: BLE001
        errors.append(f"yt-dlp: {e}")

    try:
        items = _siputz_tik(url)
        if items:
            return items
    except Exception as e:  # noqa: BLE001
        errors.append(f"siputzx: {e}")

    try:
        items = _tiktok_page_scrape(url)
        if items:
            return items
    except Exception as e:  # noqa: BLE001
        errors.append(f"tiktok-page: {e}")

    raise ValueError(f"TikTok download failed. Tried: {'; '.join(errors)}")