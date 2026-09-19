from . import _http, _ytdlp


def _collect_videos(data):
    items = []
    if not isinstance(data, dict):
        return items
    if data.get("hd"):
        items.append(data["hd"])
    if data.get("sd") and not data.get("hd"):
        items.append(data["sd"])
    for key in ("url", "video_url", "download_url", "downloadUrl", "videoUrl"):
        if data.get(key):
            items.append(data[key])
    for key in ("links", "medias"):
        for item in data.get(key) or []:
            if isinstance(item, dict) and item.get("url"):
                items.append(item["url"])
    return [{"url": u, "type": "video", "thumbnail": False}
            for u in dict.fromkeys(items) if u.startswith(("http://", "https://"))]


def _ryzendesu_fb(url):
    """Provider 2: ryzendesu public API."""
    data = _http.get_json("https://api.ryzendesu.vip/api/downloader/fbdown", params={"url": url})
    items = _collect_videos(data.get("data") or data)
    if not items:
        raise ValueError("No video URL found in response")
    return items


def _eliteprotech_fb(url):
    """Provider 3: eliteprotech public API."""
    data = _http.get_json("https://eliteprotech-apis.zone.id/fbdown", params={"url": url})
    items = _collect_videos(data.get("data") or data)
    if not items:
        raise ValueError("No video URL found in response")
    return items


def download(url):
    """Facebook fallback chain: yt-dlp -> ryzendesu -> eliteprotech."""
    errors = []

    try:
        items = _ytdlp.entries_to_items(_ytdlp.ydl_info(url))
        if items:
            return items
    except Exception as e:  # noqa: BLE001
        errors.append(f"yt-dlp: {e}")

    for provider in (_ryzendesu_fb, _eliteprotech_fb):
        try:
            items = provider(url)
            if items:
                return items
        except Exception as e:  # noqa: BLE001
            errors.append(str(e))

    raise ValueError(f"Facebook download failed. Tried: {'; '.join(errors)}")