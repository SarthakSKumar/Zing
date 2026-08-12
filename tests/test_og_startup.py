import json
import queue

import app as app_module


def test_refresh_collection_requeues_urls(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    bookmarks_path = data_dir / "bookmarks.json"
    bookmarks_path.write_text(
        json.dumps(
            {
                "collections": [
                    {
                        "id": "c1",
                        "urls": [
                            {"id": "u1", "url": "https://example.com", "og_fetched": True},
                            {"id": "u2", "url": "https://example.org", "og_fetched": False},
                        ],
                    },
                    {
                        "id": "c2",
                        "urls": [
                            {"id": "u3", "url": "https://example.net", "og_fetched": True},
                        ],
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(app_module, "DATA_DIR", str(data_dir))
    monkeypatch.setattr(app_module, "DATA_FILE", str(bookmarks_path))
    app_module.og_queue = queue.Queue()

    with app_module.app.test_client() as client:
        response = client.post("/api/collections/c1/refresh-og")

    assert response.status_code == 200
    queued = []
    while not app_module.og_queue.empty():
        queued.append(app_module.og_queue.get())

    assert queued == [("c1", "u1"), ("c1", "u2")]

    updated = json.loads(bookmarks_path.read_text(encoding="utf-8"))
    assert updated["collections"][0]["urls"][0]["og_fetched"] is False
    assert updated["collections"][0]["urls"][1]["og_fetched"] is False
