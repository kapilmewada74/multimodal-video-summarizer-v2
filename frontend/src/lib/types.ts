export interface JobResult {
  title: string;
  duration?: number;
  transcript: string;
  summary: string;
  mode?: string;
  engine?: string;
}

export interface MindMapNode {
  title: string;
  children: MindMapNode[];
}

export interface MindMapData extends MindMapNode {
  provider?: string;
}

export type OutputKind = "flashcards" | "quiz" | "mindmap" | "slides";

export interface VideoSummary {
  id: string;
  title: string | null;
  duration: number;
  status: "pending" | "processing" | "ready" | "failed";
  source: "youtube" | "upload";
  youtube_id: string | null;
  added_at: string;
  has_summary: boolean;
  progress_seconds?: number;
  completed?: boolean;
}

export interface VideoDetail {
  id: string;
  title: string | null;
  duration: number;
  status: VideoSummary["status"];
  source: "youtube" | "upload";
  youtube_id: string | null;
  added_at: string;
  summary: string | null;
  transcript: string | null;
  engine?: string | null;
  progress_seconds?: number;
  completed?: boolean;
  upload_id?: string | null;
  outputs: OutputKind[];
  share: { active: boolean; token: string | null };
}

export interface PublicVideo {
  title: string | null;
  duration: number;
  youtube_id: string | null;
  summary: string;
  mindmap: MindMapData | null;
  flashcards: { front: string; back: string; tag?: string }[] | null;
}

export interface JobState {
  id: string;
  type: "url" | "upload";
  status: "queued" | "processing" | "completed" | "failed";
  step: number;
  step_name: string;
  progress: number;
  message: string;
  result?: JobResult | null;
  error?: string | null;
  video_id?: string | null;
}

export interface HistoryItem {
  job_id: string;
  title: string;
  duration?: number;
  timestamp: number;
  summary: string;
  transcript: string;
  mode?: string;
  engine?: string;
}

// ---- study tools ---------------------------------------------------------------------------
export interface GoalProgress {
  type: "minutes" | "videos" | "quizzes";
  target: number;
  progress: number;
  unit: string;
  done: boolean;
  active: boolean;
}

export interface WeekDay {
  day: string;
  seconds: number;
  counted: boolean;
  frozen: boolean;
  is_today: boolean;
  future: boolean;
}

export interface StudySummary {
  credited: number;
  today: { seconds: number; videos_done: number; quizzes_taken: number; pomodoros?: number };
  goals: GoalProgress[];
  streak: {
    current: number; longest: number; today_done: boolean; min_seconds: number;
    freeze_available?: boolean; at_risk?: boolean; frozen_days?: string[];
  };
  week?: WeekDay[];
}

export interface StudySession {
  id: string;
  video_id: string | null;
  title: string | null;
  started_at: string;
  seconds: number;
  pomodoros: number;
}

export interface VideoStudyTime {
  video_id: string;
  title: string;
  seconds: number;
  sessions: number;
}

export interface StudyDay {
  day: string;
  seconds: number;
  videos_done: number;
  quizzes_taken: number;
  pomodoros?: number;
}

export interface StudyOverview extends StudySummary {
  days: StudyDay[];
}

export interface PlaylistSummary {
  id: string;
  title: string;
  source: "custom" | "youtube";
  item_count: number;
  completed_count: number;
  updated_at: string;
}

export interface PlaylistItem {
  id: string;
  kind?: "youtube" | "library_upload" | "device_upload" | "document";
  upload_id?: string | null;
  /** For a file row: the file itself. */
  document?: PlaylistFile | null;
  /** Files attached to this lesson (a video row). */
  documents?: DocumentItem[];
  size_bytes?: number | null;
  youtube_id: string | null;
  video_id: string | null;
  title: string;
  duration: number;
  status: "pending" | "processing" | "ready" | "failed" | "uploaded" | null;
  progress_seconds: number;
  percent: number;
  completed: boolean;
}

export interface PlaylistDetail extends PlaylistSummary {
  items: PlaylistItem[];
}

export interface PlaylistFile {
  id: string;
  filename: string;
  extension: string;
  mime: string;
  size_bytes: number;
  has_text: boolean;
}

export interface DocumentItem {
  id: string;
  video_id: string | null;
  playlist_item_id?: string | null;
  filename: string;
  extension: string;
  mime: string;
  size_bytes: number;
  has_text: boolean;
  text_status: "none" | "extracted" | "failed";
  created_at: string;
}

export interface StorageInfo {
  used_bytes: number;
  quota_bytes: number;
  max_document_bytes: number;
}

export type NotificationKind = "goal_reached" | "streak_at_risk" | "streak_milestone" | "summary_ready";
export type NotificationChannel = "in_app" | "email" | "push";

export interface AppNotification {
  id: string;
  type: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read: boolean;
}

export interface NotificationSettings {
  prefs: Record<NotificationKind, Record<NotificationChannel, boolean>>;
  reminder_hour: number;
  quiet_start: number | null;
  quiet_end: number | null;
  timezone: string;
  email_available: boolean;
  push_available: boolean;
  push_subscribed: boolean;
}
