import os

import config

VIDEO_EXTS = {"mp4", "webm", "mov", "m4v", "mkv"}


def _media_type(entry):
    """Best-effort decision: is this entry a video or an image?"""
    ext = (entry.get("ext") or entry.get("vcodec") and "").lower()
    if entry.get("vcodec") not in (None, "none"):
        return "video"
    if ext in VIDEO_EXTS:
        return "video"
    if (entry.get("protocol") or "").startswith("m3u8"):
        return "video"
    return "image"


def ydl_info(url):
    """Wrapper around yt-dlp that only extracts metadata (no download)."""
    import yt_dlp
    from yt_dlp.utils import DownloadError

    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": int(config.NETWORK_TIMEOUT),
        "outtmpl": "%(id)s.%(ext)s",
    }
    if config.COOKIES_FILE and os.path.exists(config.COOKIES_FILE):
        opts["cookiefile"] = config.COOKIES_FILE

    with yt_dlp.YoutubeDL(opts) as ydl:
        try:
            return [ydl.extract_info(url, download=False)]
        except DownloadError:
            # Fall back to flat extraction (single URL dump) if full parse fails.
            ydl.params["extract_flat"] = "in_playlist"
            return [ydl.extract_info(url, download=False)]


def entries_to_items(infos):
    """Normalize yt-dlp info dicts into our {url,type,thumbnail} items list."""
    items = []
    seen = set()

    def add(url, mtype, thumbnail):
        if not url or url in seen:
            return
        if not url.startswith(("http://", "https://")):
            return
        seen.add(url)
        items.append({"url": url, "type": mtype, "thumbnail": bool(thumbnail)})

    for info in infos or []:
        if not isinstance(info, dict):
            continue

        # Carousels / playlists expose .entries
        entries = info.get("entries") or [info]
        for entry in entries:
            if not isinstance(entry, dict):
                continue

            mtype = _media_type(entry)
            url = entry.get("url")
            if url:
                add(url, mtype, mtype == "image")

            # Prefer a direct mp4/webm format URL when present.
            for fmt in entry.get("formats", []) or []:
                ftype = _media_type(fmt)
                if ftype == "video" and fmt.get("url"):
                    add(fmt["url"], "video", False)
                    break

            # Best image thumbnail if we only got a video.
            thumb = None
            raw = entry.get("thumbnail")
            if isinstance(raw, str):
                thumb = raw
            elif isinstance(raw, dict):
                thumb = raw.get("url")
            entries_thumbs = entry.get("thumbnails")
            if not thumb and isinstance(entries_thumbs, list) and entries_thumbs:
                thumb = entries_thumbs[-1].get("url")
            if thumb and mtype == "video":
                add(thumb, "image", True)

    return items