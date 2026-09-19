import requests

import config

UA = config.USER_AGENT
TIMEOUT = config.NETWORK_TIMEOUT


def get_json(url, params=None, headers=None, timeout=TIMEOUT):
    h = {"User-Agent": UA, "Accept": "application/json, text/plain, */*"}
    if headers:
        h.update(headers)
    resp = requests.get(url, params=params, headers=h, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def get_text(url, params=None, headers=None, timeout=TIMEOUT):
    h = {"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"}
    if headers:
        h.update(headers)
    resp = requests.get(url, params=params, headers=h, timeout=timeout)
    resp.raise_for_status()
    return resp.text