"""How a playlist row is shown to the user."""
from typing import Any, Dict


def item_view(row) -> Dict[str, Any]:
    """One playlist item with the user's progress on it."""
    device = row.get("upload_id") is not None
    if row.get("document_id") is not None:
        return {
            "id": str(row["id"]), "kind": "document", "youtube_id": None, "upload_id": None, "video_id": None,
            "title": row["doc_filename"], "duration": 0, "size_bytes": row["doc_size"], "status": None,
            "progress_seconds": 0, "percent": 0, "completed": False, "documents": [],
            "document": {"id": str(row["document_id"]), "filename": row["doc_filename"], "extension": row["doc_extension"],
                         "mime": row["doc_mime"], "size_bytes": row["doc_size"], "has_text": row["doc_text_status"] == "extracted"},
        }
    if device:
        # A device upload has no summary until the user asks for one (then it follows its video).
        status = row["status"] if row["in_library"] else "uploaded"
        title = row["video_title"] or row["upload_filename"] or row["item_title"] or "Uploaded video"
        kind = "device_upload"
    else:
        status = row["status"] if row["in_library"] else None
        title = row["video_title"] or row["item_title"] or "Untitled video"
        kind = "youtube" if row["youtube_id"] else "library_upload"
    duration = row["video_duration"] or row["item_duration"] or 0
    progress = row["progress_seconds"] or 0
    return {
        "id": str(row["id"]),
        "kind": kind,
        "youtube_id": row["youtube_id"],
        "upload_id": str(row["upload_id"]) if device else None,
        "video_id": str(row["video_id"]) if row["in_library"] and row["video_id"] else None,
        "title": title,
        "duration": duration,
        "size_bytes": row.get("upload_size"),
        "status": status,                      # None: YouTube video not summarized yet
        "progress_seconds": progress,
        "percent": min(100, round(100 * progress / duration)) if duration else 0,
        "completed": row["completed_at"] is not None,
        "document": None,
        "documents": [],  # files attached to this lesson; filled in by the router
    }
