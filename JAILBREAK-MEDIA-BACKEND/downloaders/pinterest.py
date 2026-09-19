import re

from . import _http, _ytdlp


def _siputz_pin(url):
    """Provider 2: siputzx public API."""
    data = _http.get_json("https://api.siputzx.my.id/api/d/pinterestdl", params={"url": url})
    data = data.get("data") or data
    items = []

    if data.get("url"):
        is_video = data.get("type") == "video" or data["url"].endswith(".mp4")
        items.append({"url": data["url"], "type": "video" if is_video else "image",
                      "thumbnail": not is_video})

    for mu in data.get("media_urls") or []:
        if mu:
            items.append({"url": mu, "type": "video" if mu.endswith(".mp4") else "image",
                          "thumbnail": not mu.endswith(".mp4")})

    for img in data.get("images") or []:
        if isinstance(img, dict) and img.get("url"):
            items.append({"url": img["url"], "type": "image", "thumbnail": True})

    for v in data.get("videos") or []:
        if isinstance(v, dict) and v.get("url"):
            items.append({"url": v["url"], "type": "video", "thumbnail": False})

    if not items:
        raise ValueError("No media found")
    return items


def _pin_page_scrape(url):
    """Provider 3: pull og:video / og:image meta tags straight off the pin page."""
    html = _http.get_text(url)
    items = []

    og_vid = re.search(r'<meta[^>]+property="og:video(?::secure_url)?"[^>]+content="([^"]+)"', html)
    if og_vid and og_vid.group(1).startswith("http"):
        items.append({"url": og_vid.group(1), "type": "video", "thumbnail": False})

    og_img = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html)
    if og_img and og_img.group(1).startswith("http"):
        items.append({"url": og_img.group(1), "type": "image", "thumbnail": True})

    json_img = re.search(r'"image_original_url"\s*:\s*"([^"]+)"', html)
    if json_img:
        u = json_img.group(1).replace("\\u002F", "/")
        if u.startswith("http"):
            items.append({"url": u, "type": "image", "thumbnail": True})

    if not items:
        raise ValueError("No media found on pin page")
    return items


def download(url):
    """Pinterest fallback chain: yt-dlp -> siputzx -> pin-page scrape."""
    errors = []

    try:
        items = _ytdlp.entries_to_items(_ytdlp.ydl_info(url))
        if items:
            return items
    except Exception as e:  # noqa: BLE001
        errors.append(f"yt-dlp: {e}")

    try:
        items = _siputz_pin(url)
        if items:
            return items
    except Exception as e:  # noqa: BLE001
        errors.append(f"siputzx: {e}")

    try:
        items = _pin_page_scrape(url)
        if items:
            return items
    except Exception as e:  # noqa: BLE001
        errors.append(f"pin-page: {e}")

    raise ValueError(f"Pinterest download failed. Tried: {'; '.join(errors)}")