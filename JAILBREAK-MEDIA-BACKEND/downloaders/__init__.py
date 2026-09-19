from . import facebook, instagram, pinterest, tiktok

downloaders = {
    "instagram": instagram.download,
    "pinterest": pinterest.download,
    "tiktok": tiktok.download,
    "facebook": facebook.download,
}
