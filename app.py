import json
import os
import queue
import random
import subprocess
import threading
import time
import uuid
from datetime import datetime
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template, request, abort

app = Flask(__name__)
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DATA_FILE = os.path.join(DATA_DIR, "bookmarks.json")
BRAVE_PATH = r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"


@app.after_request
def add_cors(response):
    """Allow Chrome extension and other local callers to hit the API."""
    if request.path.startswith('/api/'):
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS'
    return response


@app.before_request
def handle_preflight():
    if request.method == 'OPTIONS' and request.path.startswith('/api/'):
        resp = app.make_default_options_response()
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS'
        return resp


# In-memory set of URL IDs opened this session
session_opened: set[str] = set()

# Serialize file writes across main thread + OG worker
_file_lock = threading.Lock()

# Background OG-fetch queue
og_queue: queue.Queue = queue.Queue()


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def _write_file(data: dict) -> None:
    """Atomic write — caller must already hold _file_lock, or call _save()."""
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


def _load() -> dict:
    if not os.path.exists(DATA_FILE):
        os.makedirs(DATA_DIR, exist_ok=True)
        _write_file({"collections": []})
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save(data: dict) -> None:
    with _file_lock:
        _write_file(data)


def _find_collection(data: dict, cid: str) -> dict | None:
    for c in data["collections"]:
        if c["id"] == cid:
            return c
    return None


# ---------------------------------------------------------------------------
# OG / metadata fetching
# ---------------------------------------------------------------------------

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def _fetch_og(url: str) -> dict:
    meta = {"title": "", "og_image": "", "favicon": "", "description": ""}
    try:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        resp = requests.get(url, timeout=8, headers=HEADERS,
                            allow_redirects=True)
        soup = BeautifulSoup(resp.text, "lxml")

        og_title = soup.find("meta", property="og:title")
        meta["title"] = (
            og_title["content"].strip()
            if og_title and og_title.get("content")
            else (soup.title.string.strip() if soup.title else parsed.netloc)
        )

        # Preferred image meta tags (highest priority first)
        image_selectors = [
            ("property", "og:image"),
            ("property", "og:image:url"),
            ("property", "og:image:secure_url"),
            ("name", "twitter:image"),
            ("name", "twitter:image:src"),
            ("itemprop", "image"),
        ]

        for attr, value in image_selectors:
            tag = soup.find("meta", attrs={attr: value})
            if not tag:
                continue

            img_url = (tag.get("content") or "").strip()
            if not img_url:
                continue

            if img_url.startswith("//"):
                img_url = parsed.scheme + ":" + img_url
            elif img_url.startswith("/"):
                img_url = origin + img_url
            elif not img_url.startswith(("http://", "https://")):
                img_url = origin + "/" + img_url.lstrip("/")

            meta["og_image"] = img_url
            break

        og_desc = soup.find("meta", property="og:description")
        if og_desc and og_desc.get("content"):
            meta["description"] = og_desc["content"].strip()

        icon_link = soup.find("link", rel=lambda r: r and "icon" in r)
        if icon_link and icon_link.get("href"):
            href = icon_link["href"].strip()
            if href.startswith("//"):
                href = parsed.scheme + ":" + href
            elif href.startswith("/"):
                href = origin + href
            elif not href.startswith("http"):
                href = origin + "/" + href
            meta["favicon"] = href
        else:
            meta["favicon"] = f"{origin}/favicon.ico"
    except Exception:
        pass
    return meta


# ---------------------------------------------------------------------------
# OG background worker
# ---------------------------------------------------------------------------

def _process_og_item(cid: str, url_id: str) -> None:
    """Fetch OG for one URL and persist it. Called by worker thread."""
    # Quick pre-check (no lock needed — worst case we fetch an already-done item)
    data = _load()
    col = _find_collection(data, cid)
    if not col:
        return
    entry = next((u for u in col["urls"] if u["id"] == url_id), None)
    if not entry:
        return

    url_to_fetch = entry["url"]
    meta = _fetch_og(url_to_fetch)   # network I/O — outside any lock

    # Atomic write
    with _file_lock:
        data = _load()
        col = _find_collection(data, cid)
        if not col:
            return
        entry = next((u for u in col["urls"] if u["id"] == url_id), None)
        if not entry:
            return
        entry["title"] = meta["title"] or entry.get("title") or url_to_fetch
        entry["og_image"] = meta["og_image"]
        entry["favicon"] = meta["favicon"]
        entry["description"] = meta["description"]
        entry["og_fetched"] = True
        _write_file(data)


def _queue_collection_og_items(cid: str) -> None:
    """Queue OG refresh for every URL in a collection."""
    data = _load()
    col = _find_collection(data, cid)
    if not col:
        return
    for entry in col.get("urls", []):
        url = (entry.get("url") or "").strip()
        if not url:
            continue
        entry["og_fetched"] = False
        og_queue.put((cid, entry["id"]))
    _save(data)


def _og_worker() -> None:
    while True:
        item = og_queue.get()
        if item is None:
            og_queue.task_done()
            break
        cid, url_id = item
        try:
            _process_og_item(cid, url_id)
        except Exception:
            # Mark as fetched (failed) so we don't retry indefinitely
            try:
                with _file_lock:
                    data = _load()
                    col = _find_collection(data, cid)
                    if col:
                        entry = next(
                            (u for u in col["urls"] if u["id"] == url_id), None)
                        if entry and entry.get("og_fetched") is False:
                            entry["og_fetched"] = True
                            _write_file(data)
            except Exception:
                pass
        finally:
            og_queue.task_done()


_og_thread = threading.Thread(target=_og_worker, daemon=True, name="og-worker")
_og_thread.start()

# ---------------------------------------------------------------------------
# Collection PIN store (in-memory; PINs also stored in bookmarks.json)
# Unlock timestamps — collection is "unlocked" for LOCK_TIMEOUT seconds
# ---------------------------------------------------------------------------
_unlock_times: dict[str, float] = {}
_lock_timeout_cache: int | None = None
_lock_timeout_ts: float = 0.0


def get_lock_timeout() -> int:
    """Read lock timeout from settings with 60-second in-memory cache."""
    global _lock_timeout_cache, _lock_timeout_ts
    now = time.time()
    if _lock_timeout_cache is None or now - _lock_timeout_ts > 60:
        s = _load_settings()
        _lock_timeout_cache = int(s.get('collectionLockTimeout', 120))
        _lock_timeout_ts = now
    return _lock_timeout_cache


def _is_unlocked(cid: str) -> bool:
    t = _unlock_times.get(cid)
    if t is None:
        return False
    if time.time() - t < get_lock_timeout():
        return True
    _unlock_times.pop(cid, None)
    return False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mark_opened_and_reorder(col: dict, url_ids: list[str]) -> None:
    """Set last_opened_at, increment open_count + move opened URLs to end of col['urls']."""
    now = datetime.utcnow().isoformat()
    ids_set = set(url_ids)
    stayed = [u for u in col["urls"] if u["id"] not in ids_set]
    moved = [u for u in col["urls"] if u["id"] in ids_set]
    for u in moved:
        u["last_opened_at"] = now
        u["open_count"] = u.get("open_count", 0) + 1
    col["urls"] = stayed + moved


# ---------------------------------------------------------------------------
# Routes — pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/favicon.ico")
def favicon():
    from flask import send_from_directory
    return send_from_directory(
        os.path.join(os.path.dirname(__file__), "static"),
        "favicon.ico", mimetype="image/vnd.microsoft.icon"
    )


# ---------------------------------------------------------------------------
# Routes — collections
# ---------------------------------------------------------------------------

@app.route("/api/collections", methods=["GET"])
def get_collections():
    data = _load()
    return jsonify([_sanitize_col(c) for c in data["collections"]])


@app.route("/api/collections", methods=["POST"])
def create_collection():
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    if not name:
        abort(400, "name required")
    pin = (body.get("pin") or "").strip()
    # Validate PIN: exactly 6 digits if provided
    if pin and (not pin.isdigit() or len(pin) != 6):
        abort(400, "pin must be exactly 6 digits")
    data = _load()
    col = {
        "id":         str(uuid.uuid4()),
        "name":       name,
        "created_at": datetime.utcnow().isoformat(),
        "urls":       [],
        # stored as plain string (app-local only)
        "pin":        pin if pin else None,
    }
    data["collections"].append(col)
    _save(data)
    if pin:
        _unlock_times[col["id"]] = time.time()  # creator gets immediate access
    return jsonify(_sanitize_col(col)), 201


def _sanitize_col(col: dict) -> dict:
    """Return collection without exposing the PIN to the frontend."""
    c = {k: v for k, v in col.items() if k != "pin"}
    c["locked"] = bool(col.get("pin"))
    c["unlocked"] = _is_unlocked(col["id"])
    return c


@app.route("/api/collections/<cid>/unlock", methods=["POST"])
def unlock_collection(cid: str):
    body = request.get_json(force=True)
    pin = (body.get("pin") or "").strip()
    data = _load()
    col = _find_collection(data, cid)
    if not col:
        abort(404)
    stored = col.get("pin")
    if not stored:
        return jsonify({"ok": True, "message": "Collection is not locked."})
    if pin != stored:
        return jsonify({"ok": False, "message": "Incorrect PIN."}), 403
    _unlock_times[cid] = time.time()
    return jsonify({"ok": True})


@app.route("/api/collections/<cid>/lock", methods=["POST"])
def lock_collection(cid: str):
    _unlock_times.pop(cid, None)
    return jsonify({"ok": True})


@app.route("/api/collections/<cid>/set-pin", methods=["POST"])
def set_pin(cid: str):
    body = request.get_json(force=True)
    pin = (body.get("pin") or "").strip()
    if pin and (not pin.isdigit() or len(pin) != 6):
        abort(400, "pin must be exactly 6 digits")
    data = _load()
    col = _find_collection(data, cid)
    if not col:
        abort(404)
    col["pin"] = pin if pin else None
    _save(data)
    if pin:
        # setting new PIN keeps session unlocked
        _unlock_times[cid] = time.time()
    else:
        _unlock_times.pop(cid, None)
    return jsonify({"ok": True})


@app.route("/api/collections/<cid>", methods=["PATCH"])
def rename_collection(cid: str):
    body = request.get_json(force=True)
    name = (body.get("name") or "").strip()
    if not name:
        abort(400, "name required")
    data = _load()
    col = _find_collection(data, cid)
    if not col:
        abort(404)
    if col.get("pin") and not _is_unlocked(cid):
        return jsonify({"ok": False, "error": "locked", "message": "Collection is locked."}), 403
    col["name"] = name
    _save(data)
    return jsonify(_sanitize_col(col))


@app.route("/api/collections/<cid>", methods=["DELETE"])
def delete_collection(cid: str):
    data = _load()
    col = _find_collection(data, cid)
    if not col:
        abort(404)
    if col.get("pin"):
        body = request.get_json(force=True, silent=True) or {}
        pin = (body.get("pin") or "").strip()
        if not pin:
            return jsonify({"ok": False, "error": "pin_required", "message": "PIN required."}), 403
        if pin != col["pin"]:
            return jsonify({"ok": False, "error": "wrong_pin", "message": "Incorrect PIN."}), 403
    data["collections"] = [c for c in data["collections"] if c["id"] != cid]
    _unlock_times.pop(cid, None)
    _save(data)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Routes — URLs
# ---------------------------------------------------------------------------

@app.route("/api/collections/<cid>/refresh-og", methods=["POST"])
def refresh_collection_og(cid: str):
    data = _load()
    col = _find_collection(data, cid)
    if not col:
        abort(404)
    _queue_collection_og_items(cid)
    return jsonify({"ok": True, "queued": len(col.get("urls", []))})


@app.route("/api/collections/<cid>/urls", methods=["POST"])
def add_urls(cid: str):
    body = request.get_json(force=True)
    raw_urls = body.get("urls", [])
    if not raw_urls:
        abort(400, "urls array required")

    data = _load()
    col = _find_collection(data, cid)
    if not col:
        abort(404)

    existing_urls = {u["url"] for u in col["urls"]}
    added = []
    skipped = []

    for item in raw_urls:
        # Accept either a plain URL string or {url, title, og_image, favicon} dict
        if isinstance(item, dict):
            url = (item.get("url") or "").strip()
            pre_title = (item.get("title") or "").strip()
            pre_image = (item.get("og_image") or "").strip()
            pre_fav = (item.get("favicon") or "").strip()
        else:
            url = (item or "").strip()
            pre_title = pre_image = pre_fav = ""

        if not url:
            continue
        if url in existing_urls:
            skipped.append(url)
            continue
        parsed = urlparse(url)
        initial_title = pre_title or (parsed.netloc.replace(
            "www.", "") + (parsed.path.rstrip("/") or "")).strip("/")
        # If caller already supplied og/favicon, mark as fetched
        already_fetched = bool(pre_image or pre_fav)
        if not pre_fav:
            pre_fav = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
        entry = {
            "id":             str(uuid.uuid4()),
            "url":            url,
            "title":          initial_title or url,
            "og_image":       pre_image,
            "favicon":        pre_fav,
            "description":    "",
            "added_at":       datetime.utcnow().isoformat(),
            "og_fetched":     already_fetched,
            "last_opened_at": None,
            "open_count":     0,
        }
        col["urls"].append(entry)
        existing_urls.add(url)
        added.append(entry)

    _save(data)

    # Queue background OG fetch for each new URL
    for entry in added:
        og_queue.put((cid, entry["id"]))

    return jsonify({"added": added, "skipped": skipped})


@app.route("/api/collections/<cid>/urls/<uid>", methods=["DELETE"])
def delete_url(cid: str, uid: str):
    data = _load()
    col = _find_collection(data, cid)
    if not col:
        abort(404)
    before = len(col["urls"])
    col["urls"] = [u for u in col["urls"] if u["id"] != uid]
    if len(col["urls"]) == before:
        abort(404)
    session_opened.discard(uid)
    _save(data)
    return jsonify({"ok": True})


@app.route("/api/collections/<cid>/urls/batch-delete", methods=["POST"])
def batch_delete_urls(cid: str):
    body = request.get_json(force=True)
    ids_to_delete = set(body.get("url_ids", []))
    if not ids_to_delete:
        abort(400, "url_ids required")
    data = _load()
    col = _find_collection(data, cid)
    if not col:
        abort(404)
    before = len(col["urls"])
    col["urls"] = [u for u in col["urls"] if u["id"] not in ids_to_delete]
    deleted = before - len(col["urls"])
    for uid in ids_to_delete:
        session_opened.discard(uid)
    _save(data)
    return jsonify({"ok": True, "deleted": deleted})


# ---------------------------------------------------------------------------
# Routes — move URL between collections
# ---------------------------------------------------------------------------

@app.route("/api/collections/<cid>/urls/<uid>/move", methods=["POST"])
def move_url(cid: str, uid: str):
    body = request.get_json(force=True)
    to_cid = body.get("to_collection_id", "").strip()
    if not to_cid:
        abort(400, "to_collection_id required")
    data = _load()
    src_col = _find_collection(data, cid)
    dst_col = _find_collection(data, to_cid)
    if not src_col or not dst_col:
        abort(404)
    entry = next((u for u in src_col["urls"] if u["id"] == uid), None)
    if not entry:
        abort(404)
    # Remove from source
    src_col["urls"] = [u for u in src_col["urls"] if u["id"] != uid]
    # Add to destination (skip if URL already present)
    if not any(u["url"] == entry["url"] for u in dst_col["urls"]):
        dst_col["urls"].append(entry)
    _save(data)
    session_opened.discard(uid)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Routes — BuiltWith analysis
# ---------------------------------------------------------------------------

BUILTWITH_API_KEY = "248f1772-a31b-4f5b-a776-199d0d93c7cc"


@app.route("/api/builtwith")
def builtwith_lookup():
    """Proxy the BuiltWith free API for a given domain."""
    domain = request.args.get("domain", "").strip().lower()
    if not domain:
        abort(400, "domain param required")
    # Strip scheme/path if someone passed a full URL
    try:
        from urllib.parse import urlparse as _up
        p = _up(domain if "://" in domain else "https://" + domain)
        domain = p.netloc or domain
        domain = domain.lstrip("www.")
    except Exception:
        pass

    api_url = f"https://api.builtwith.com/free1/api.json?KEY={BUILTWITH_API_KEY}&LOOKUP={domain}"
    try:
        resp = requests.get(api_url, timeout=12, headers=HEADERS)
        if not resp.ok:
            return jsonify({"error": f"BuiltWith API returned {resp.status_code}"}), resp.status_code
        data = resp.json()
        return jsonify(data)
    except requests.exceptions.Timeout:
        return jsonify({"error": "BuiltWith API timed out"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Routes — OG preview
# ---------------------------------------------------------------------------

@app.route("/api/og")
def og_preview():
    url = request.args.get("url", "").strip()
    if not url:
        abort(400, "url param required")
    return jsonify(_fetch_og(url))


# ---------------------------------------------------------------------------
# Routes — Settings
# ---------------------------------------------------------------------------

SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')

DEFAULT_SETTINGS = {
    "profile": {
        "username": ""
    },
    "jsonPrettify": {
        "enabledByDefault": True
    },
    "dateTime": {
        "useSystemSettings": True,
        "timezone": "UTC",
        "dateFormat": "D MMM YYYY",
        "hourFormat": "24"
    },
    "historyScrub": {
        "enabled": True,
        "words": ["dangerous"],
        "frequency": "startup"
    },
    "collectionLockTimeout": 120,
    "softRefreshInterval": 30,
    "viewedOverlay": {
        "domains": []
    }
}


def _load_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                stored = json.load(f)
            # Deep merge stored over defaults so new keys always present
            result = {k: dict(v) if isinstance(v, dict) else v
                      for k, v in DEFAULT_SETTINGS.items()}
            for k, v in stored.items():
                if isinstance(v, dict) and isinstance(result.get(k), dict):
                    result[k] = {**result[k], **v}
                else:
                    result[k] = v
            return result
        except Exception:
            pass
    return {k: dict(v) if isinstance(v, dict) else v
            for k, v in DEFAULT_SETTINGS.items()}


def _save_settings(settings: dict) -> None:
    global _lock_timeout_cache
    _lock_timeout_cache = None  # invalidate cache so next call re-reads
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(settings, f, indent=2)
    os.replace(tmp, SETTINGS_FILE)


@app.route('/api/settings', methods=['GET'])
def get_settings():
    return jsonify(_load_settings())


@app.route('/api/settings', methods=['PATCH'])
def update_settings():
    data = request.get_json(force=True) or {}
    settings = _load_settings()
    for k, v in data.items():
        if isinstance(v, dict) and isinstance(settings.get(k), dict):
            settings[k] = {**settings[k], **v}
        else:
            settings[k] = v
    _save_settings(settings)
    return jsonify(settings)


# ---------------------------------------------------------------------------
# Routes — open URLs in Brave
# ---------------------------------------------------------------------------

@app.route("/api/open-random", methods=["POST"])
def open_random():
    body = request.get_json(force=True)
    cid = body.get("collection_id", "").strip()
    count = int(body.get("count", 7))

    data = _load()
    col = _find_collection(data, cid)
    if not col:
        abort(404)

    eligible = [u for u in col["urls"] if u["id"] not in session_opened]
    if not eligible:
        return jsonify({"opened": [], "message": "All URLs already opened this session."})

    chosen = random.sample(eligible, min(count, len(eligible)))
    urls_to_open = [u["url"] for u in chosen]
    ids_opened = [u["id"] for u in chosen]

    for uid in ids_opened:
        session_opened.add(uid)

    _mark_opened_and_reorder(col, ids_opened)
    _save(data)

    try:
        subprocess.Popen([BRAVE_PATH, "--incognito"] + urls_to_open)
    except FileNotFoundError:
        return jsonify({
            "opened":  ids_opened,
            "message": f"Brave not found at: {BRAVE_PATH}. URLs marked as opened.",
            "error":   "brave_not_found",
        })

    return jsonify({
        "opened":  ids_opened,
        "message": f"Opened {len(ids_opened)} URL(s) in Brave private window.",
    })


@app.route("/api/open-random-global", methods=["POST"])
def open_random_global():
    """Open N random URLs drawn from one or more (or all) collections."""
    body = request.get_json(force=True)
    cids = body.get("collection_ids", [])   # [] = all collections
    count = int(body.get("count", 7))
    private_mode = body.get("private", True)

    data = _load()

    # Gather eligible URLs — locked collections only included if unlocked this session
    eligible = []
    for col in data["collections"]:
        if cids and col["id"] not in cids:
            continue
        if col.get("pin") and not _is_unlocked(col["id"]):
            continue  # skip locked collections
        for u in col["urls"]:
            if u["id"] not in session_opened:
                eligible.append((col, u))

    if not eligible:
        return jsonify({"opened": [], "message": "All URLs already opened this session."})

    chosen = random.sample(eligible, min(count, len(eligible)))
    urls_to_open = [u["url"] for _, u in chosen]
    ids_opened = [u["id"] for _, u in chosen]

    for uid in ids_opened:
        session_opened.add(uid)

    # Group by collection for efficient reorder
    col_url_map: dict[str, list[str]] = {}
    for col, u in chosen:
        col_url_map.setdefault(col["id"], []).append(u["id"])

    for col in data["collections"]:
        if col["id"] in col_url_map:
            _mark_opened_and_reorder(col, col_url_map[col["id"]])

    _save(data)

    incognito_flag = "--incognito" if private_mode else ""
    cmd = [BRAVE_PATH] + \
        ([incognito_flag] if incognito_flag else []) + urls_to_open
    try:
        subprocess.Popen(cmd)
    except FileNotFoundError:
        return jsonify({
            "opened":  ids_opened,
            "message": f"Brave not found at: {BRAVE_PATH}. URLs marked as opened.",
            "error":   "brave_not_found",
        })

    return jsonify({
        "opened":  ids_opened,
        "message": f"Opened {len(ids_opened)} URL(s) in Brave {'private' if private_mode else 'normal'} window.",
    })


@app.route("/api/open-url", methods=["POST"])
def open_single_url():
    body = request.get_json(force=True)
    url = (body.get("url") or "").strip()
    url_id = (body.get("url_id") or "").strip()
    cid = (body.get("collection_id") or "").strip()
    private_mode = body.get("private", True)
    if not url:
        abort(400, "url required")
    if url_id:
        session_opened.add(url_id)
    if cid and url_id:
        data = _load()
        col = _find_collection(data, cid)
        if col:
            _mark_opened_and_reorder(col, [url_id])
            _save(data)
    incognito_flag = "--incognito" if private_mode else None
    cmd = [BRAVE_PATH] + ([incognito_flag] if incognito_flag else []) + [url]
    try:
        subprocess.Popen(cmd)
    except FileNotFoundError:
        return jsonify({"ok": True, "error": "brave_not_found",
                        "message": f"Brave not found at: {BRAVE_PATH}."})
    return jsonify({"ok": True})


@app.route("/api/session/status", methods=["GET"])
def session_status():
    return jsonify({"opened_ids": list(session_opened)})


@app.route("/api/session/reset", methods=["POST"])
def session_reset():
    session_opened.clear()
    return jsonify({"ok": True})


@app.route("/api/locks/reset-all", methods=["POST"])
def locks_reset_all():
    _unlock_times.clear()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Routes — Settings
# ---------------------------------------------------------------------------

SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')

DEFAULT_SETTINGS = {
    "profile": {"username": ""},
    "jsonPrettify": {"enabledByDefault": True},
    "dateTime": {
        "useSystemSettings": True,
        "timezone": "UTC",
        "dateFormat": "D MMM YYYY",
        "hourFormat": "24"
    },
    "historyScrub": {
        "enabled": True,
        "words": ["dangerous"],
        "frequency": "startup"
    },
    "collectionLockTimeout": 120,
    "softRefreshInterval": 30,
    "viewedOverlay": {"domains": []}
}


def _load_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                stored = json.load(f)
            result = {k: dict(v) if isinstance(v, dict) else v
                      for k, v in DEFAULT_SETTINGS.items()}
            for k, v in stored.items():
                if isinstance(v, dict) and isinstance(result.get(k), dict):
                    result[k] = {**result[k], **v}
                else:
                    result[k] = v
            return result
        except Exception:
            pass
    return {k: dict(v) if isinstance(v, dict) else v
            for k, v in DEFAULT_SETTINGS.items()}


def _save_settings(settings: dict) -> None:
    global _lock_timeout_cache
    _lock_timeout_cache = None
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(settings, f, indent=2)
    os.replace(tmp, SETTINGS_FILE)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
