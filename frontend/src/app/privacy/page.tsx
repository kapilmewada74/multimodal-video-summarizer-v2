import type { Metadata } from "next";
import { LegalPage } from "../../components/LegalPage";
import { SITE } from "../../lib/site";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what {SITE.name}, run by {SITE.operator}, collects, why, who receives it and what you can
        do about it. We keep it short because we collect little.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> your email address, name and profile picture from Google (if you sign in with Google), or just your email (if you use an emailed sign-in link).</li>
        <li><b>Your content:</b> the video links you submit, files you upload (videos, documents), and what is made from them: transcripts, summaries, flashcards, quizzes, slides, mind maps, your notes and edits.</li>
        <li><b>Study activity:</b> study session time, streaks, goals, quiz results and playlists.</li>
        <li><b>Usage safeguards:</b> a one-way scrambled (hashed) form of your network address, used only to limit abuse. We do not store the address itself.</li>
        <li><b>Notification settings,</b> and, if you turn browser notifications on, the address your browser gives us to reach it.</li>
      </ul>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your data and we do not show advertising.</li>
        <li>We do not use advertising or cross-site tracking cookies.</li>
        <li>We do not use your content to train AI models ourselves. See &quot;Service providers&quot; for how our AI providers treat it.</li>
      </ul>

      <h2>How we use it</h2>
      <p>To run the service you asked for: sign you in, process your videos, store your results, apply the daily limit, send notifications you chose, keep the service secure, and understand overall usage so we can improve it.</p>

      <h2>Service providers</h2>
      <p>We use trusted companies to run the service. Each receives only what it needs:</p>
      <ul>
        <li><b>Supabase</b> &mdash; database, sign-in and file storage.</li>
        <li><b>Google</b> &mdash; sign-in with Google; and, only if you ask, saving a study pack to your Google Drive.</li>
        <li><b>AI providers</b> (for example Groq, Google Gemini, xAI) &mdash; receive the transcript text of a video, and the text of documents you attach for context, to generate summaries and study material.</li>
        <li><b>Email delivery</b> &mdash; sends sign-in links and notifications you enabled.</li>
        <li><b>Hosting and error monitoring</b> &mdash; run the servers and tell us when something breaks. Error reports are set up not to include personal data.</li>
        <li><b>Privacy-friendly analytics</b> (if enabled) &mdash; counts page views and key steps without cookies or personal data.</li>
      </ul>

      <h2>Shared summaries</h2>
      <p>If you create a share link, anyone with the link can read that summary until you turn the link off. Your name and email are not shown on it.</p>

      <h2>How long we keep it</h2>
      <p>Until you delete it or your account. Temporary working files from processing are removed automatically. The abuse-prevention records are deleted after a short period.</p>

      <h2>Your choices and rights</h2>
      <ul>
        <li><b>Download your data:</b> Settings &rarr; Your data &rarr; Download my data.</li>
        <li><b>Delete your account:</b> Settings &rarr; Your data &rarr; Delete my account. This permanently removes your account, your content and your uploaded files.</li>
        <li>You can also ask us to correct, restrict or provide your data, or complain to your data-protection authority.</li>
      </ul>

      <h2>Children</h2>
      <p>The service is not directed at children under 13 (or the age required in your country). If you believe a child has given us data, contact us and we will delete it.</p>

      <h2>Security</h2>
      <p>Data is encrypted in transit, access to your content is limited to your account by database access rules, and file links are short-lived. No system is perfectly secure; we will tell affected users and authorities when the law requires it.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a meaningful way we will update the date above and, for big changes, tell you in the app or by email.</p>
    </LegalPage>
  );
}
