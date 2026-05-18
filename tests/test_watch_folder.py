from pathlib import Path

import pytest

from app import watch_settings
from app.routes import index as index_route
from indexer import pipeline


def test_watched_dir_defaults_to_project_watched_docs(tmp_path, monkeypatch):
    default_dir = tmp_path / "watched_docs"
    monkeypatch.setattr(watch_settings, "USER_SETTINGS_PATH", tmp_path / "data" / "user-settings.local")
    monkeypatch.setattr(watch_settings, "WATCHED_DOCS_DIR", default_dir)

    assert watch_settings.get_watched_docs_dir() == default_dir.resolve()


def test_watched_dirs_reads_multiple_configured_paths(tmp_path, monkeypatch):
    one = tmp_path / "one"
    two = tmp_path / "two"
    settings_path = tmp_path / "data" / "user-settings.local"
    settings_path.parent.mkdir()
    settings_path.write_text(
        '{"watch": {"directories": ["'
        + str(one).replace("\\", "\\\\")
        + '", "'
        + str(two).replace("\\", "\\\\")
        + '"]}}\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(watch_settings, "USER_SETTINGS_PATH", settings_path)

    assert watch_settings.get_watched_docs_dirs() == [one.resolve(), two.resolve()]


def test_index_all_uses_configured_watch_directory(tmp_path, monkeypatch):
    watched = tmp_path / "chosen"
    other = tmp_path / "watched_docs"
    watched.mkdir()
    other.mkdir()
    (watched / "chosen.pdf").write_bytes(b"")
    (other / "ignored.pdf").write_bytes(b"")

    settings_path = tmp_path / "data" / "user-settings.local"
    settings_path.parent.mkdir()
    settings_path.write_text(
        '{"watch": {"directory": "' + str(watched).replace("\\", "\\\\") + '"}}\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(watch_settings, "USER_SETTINGS_PATH", settings_path)
    monkeypatch.setattr(pipeline, "get_all_documents_mtimes", lambda: {})

    indexed_paths = []

    def fake_index_file(path: Path, known_mtime=None):
        indexed_paths.append(path.name)
        return True, "indexed"

    monkeypatch.setattr(pipeline, "index_file", fake_index_file)

    indexed, skipped = pipeline.index_all()

    assert (indexed, skipped) == (1, 0)
    assert indexed_paths == ["chosen.pdf"]


def test_index_all_uses_all_configured_watch_directories(tmp_path, monkeypatch):
    one = tmp_path / "one"
    two = tmp_path / "two"
    one.mkdir()
    two.mkdir()
    (one / "one.pdf").write_bytes(b"")
    (two / "two.pdf").write_bytes(b"")

    monkeypatch.setattr(pipeline, "get_watched_docs_dirs", lambda: [one, two])
    monkeypatch.setattr(pipeline, "get_all_documents_mtimes", lambda: {})

    indexed_paths = []

    def fake_index_file(path: Path, known_mtime=None):
        indexed_paths.append(path.name)
        return True, "indexed"

    monkeypatch.setattr(pipeline, "index_file", fake_index_file)

    indexed, skipped = pipeline.index_all()

    assert (indexed, skipped) == (2, 0)
    assert indexed_paths == ["one.pdf", "two.pdf"]


@pytest.mark.asyncio
async def test_list_documents_discovers_files_in_configured_watch_directory(tmp_path, monkeypatch):
    watched = tmp_path / "chosen"
    watched.mkdir()
    (watched / "chosen.pdf").write_bytes(b"pdf")
    (tmp_path / "ignored.pdf").write_bytes(b"pdf")

    monkeypatch.setattr(index_route, "get_watched_docs_dirs", lambda: [watched])
    monkeypatch.setattr(index_route, "get_all_documents", lambda: [])

    response = await index_route.list_documents()

    assert response["total"] == 1
    assert response["documents"][0]["filename"] == "chosen.pdf"


@pytest.mark.asyncio
async def test_list_documents_discovers_files_in_all_configured_watch_directories(tmp_path, monkeypatch):
    one = tmp_path / "one"
    two = tmp_path / "two"
    one.mkdir()
    two.mkdir()
    (one / "one.pdf").write_bytes(b"pdf")
    (two / "two.pdf").write_bytes(b"pdf")

    monkeypatch.setattr(index_route, "get_watched_docs_dirs", lambda: [one, two])
    monkeypatch.setattr(index_route, "get_all_documents", lambda: [])

    response = await index_route.list_documents()

    assert response["total"] == 2
    assert [doc["filename"] for doc in response["documents"]] == ["one.pdf", "two.pdf"]


def test_delete_documents_outside_keeps_new_watch_folder_docs(tmp_path, monkeypatch):
    watched = tmp_path / "chosen"
    watched.mkdir()
    inside = watched / "keep.pdf"
    outside = tmp_path / "old" / "drop.pdf"

    monkeypatch.setattr(
        index_route,
        "get_all_documents",
        lambda: [
            {"doc_id": "keep", "filepath": str(inside)},
            {"doc_id": "drop", "filepath": str(outside)},
        ],
    )
    deleted_sql = []
    deleted_qdrant = []
    monkeypatch.setattr(index_route, "delete_document", lambda doc_id: deleted_sql.append(doc_id))
    monkeypatch.setattr(index_route, "delete_doc", lambda doc_id: deleted_qdrant.append(doc_id))

    deleted = index_route._delete_documents_outside(watched)

    assert deleted == 1
    assert deleted_sql == ["drop"]
    assert deleted_qdrant == ["drop"]


def test_delete_documents_outside_keeps_all_watch_folder_docs(tmp_path, monkeypatch):
    one = tmp_path / "one"
    two = tmp_path / "two"
    one.mkdir()
    two.mkdir()
    keep_one = one / "keep-one.pdf"
    keep_two = two / "keep-two.pdf"
    outside = tmp_path / "old" / "drop.pdf"

    monkeypatch.setattr(
        index_route,
        "get_all_documents",
        lambda: [
            {"doc_id": "keep-one", "filepath": str(keep_one)},
            {"doc_id": "keep-two", "filepath": str(keep_two)},
            {"doc_id": "drop", "filepath": str(outside)},
        ],
    )
    deleted_sql = []
    deleted_qdrant = []
    monkeypatch.setattr(index_route, "delete_document", lambda doc_id: deleted_sql.append(doc_id))
    monkeypatch.setattr(index_route, "delete_doc", lambda doc_id: deleted_qdrant.append(doc_id))

    deleted = index_route._delete_documents_outside([one, two])

    assert deleted == 1
    assert deleted_sql == ["drop"]
    assert deleted_qdrant == ["drop"]
