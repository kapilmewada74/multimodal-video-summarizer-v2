"""Save a study pack to the user's own Google Drive.

The browser obtains a short-lived Google access token (scope `drive.file`, which
only allows the app to touch files it created) and sends it with the request.
The token is used for this one upload and is never stored or logged.
"""
import json
import secrets
from typing import Any, Dict, Optional

import httpx

UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files"
GOOGLE_DOC = "application/vnd.google-apps.document"


class DriveAuthError(Exception):
    """Google refused the token (expired, revoked, or missing the Drive permission)."""


class DriveError(Exception):
    """Google could not save the file."""


def upload_document(access_token: str, name: str, text: str, client: Optional[httpx.Client] = None) -> Dict[str, Any]:
    """Create a Google Doc named `name` with `text` as its content. Returns id, name and link."""
    boundary = "drive-" + secrets.token_hex(16)
    metadata = json.dumps({"name": name[:200] or "Study notes", "mimeType": GOOGLE_DOC})
    body = (
        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n"
        f"--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{text}\r\n--{boundary}--"
    ).encode("utf-8")
    try:
        response = (client or httpx).post(
            UPLOAD_URL,
            params={"uploadType": "multipart", "fields": "id,name,webViewLink"},
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": f"multipart/related; boundary={boundary}"},
            content=body,
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        raise DriveError("Could not reach Google Drive.") from exc
    if response.status_code in (401, 403):
        raise DriveAuthError()
    if response.status_code >= 400:
        raise DriveError(f"Google Drive answered {response.status_code}.")
    try:
        data = response.json()
        return {"id": data["id"], "name": data.get("name", name), "url": data.get("webViewLink") or f"https://docs.google.com/document/d/{data['id']}/edit"}
    except (ValueError, KeyError) as exc:
        raise DriveError("Unexpected answer from Google Drive.") from exc
