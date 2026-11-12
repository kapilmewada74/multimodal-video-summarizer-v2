import { getSupabase } from "./supabase";

/**
 * Calls `onChange` whenever the given job row changes (live progress through
 * Supabase Realtime). Returns a function that stops listening.
 * If Realtime is unavailable this does nothing; the caller still polls.
 */
export function watchJob(jobId: string, onChange: () => void): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => undefined;
  const channel = supabase
    .channel(`job-${jobId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `id=eq.${jobId}` }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
