"use client";

import { useCallback, useState } from "react";
import { uploadDocuments, type UploadProgress } from "./api";

/** Uploads files to one lesson (a video row in a playlist). Shared by the files button and by dropping onto the row. */
export function useLessonUpload(
  playlistItemId: string,
  onChanged: () => Promise<void> | void,
  onToast: (message: string, type?: "success" | "info" | "error") => void,
  maxBytes = 25 * 1024 * 1024,
) {
  const [pending, setPending] = useState<UploadProgress[]>([]);

  const upload = useCallback(
    async (files: File[]) => {
      const stored = await uploadDocuments({
        files, endpoint: "/api/documents", fields: { playlist_item_id: playlistItemId }, maxBytes,
        onProgress: (update) => setPending(update), onToast,
      });
      if (stored > 0) {
        onToast(stored === 1 ? "File added." : `${stored} files added.`, "success");
        await onChanged();
      }
    },
    [playlistItemId, onChanged, onToast, maxBytes],
  );

  const dismiss = useCallback((key: string) => setPending((list) => list.filter((x) => x.key !== key)), []);
  return { pending, upload, dismiss };
}
