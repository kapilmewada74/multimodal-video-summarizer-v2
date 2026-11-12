import type { Metadata } from "next";
import { LegalPage } from "../../components/LegalPage";
import { SITE } from "../../lib/site";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>By using {SITE.name} (the &quot;Service&quot;), run by {SITE.operator}, you agree to these terms. If you do not agree, please do not use the Service.</p>

      <h2>The Service</h2>
      <p>{SITE.name} turns videos and documents into study material using automated tools, including AI. It is free to use, with limits such as a daily number of videos, to keep it available to everyone. We may change, limit or stop features at any time.</p>

      <h2>Your account</h2>
      <ul>
        <li>You sign in with Google or an emailed link. Keep access to your account to yourself.</li>
        <li>You must be old enough to agree to these terms where you live, and at least 13.</li>
        <li>You are responsible for what happens under your account.</li>
      </ul>

      <h2>Your content</h2>
      <p>You keep ownership of what you submit and of the study material made from it. You give us permission to store and process it, including sending the text to our AI providers, only to provide the Service to you.</p>
      <p>You promise that you have the right to use the videos, files and documents you submit, and that your use respects the rules of the video platform they come from and the copyright of their owners.</p>

      <h2>Acceptable use</h2>
      <ul>
        <li>No unlawful, infringing, harmful or abusive content.</li>
        <li>No attempts to break, overload, scrape or bypass the limits of the Service, or to access other people&apos;s data.</li>
        <li>No automated mass submission of videos.</li>
        <li>No use of the Service to build a competing product by copying its output at scale.</li>
      </ul>
      <p>We may remove content or suspend accounts that break these rules.</p>

      <h2>AI output can be wrong</h2>
      <p>Summaries, transcripts, quizzes and other output are generated automatically and may contain mistakes or omissions. Check anything important against the original source. The Service is a study aid, not professional, legal, medical or academic advice.</p>

      <h2>Sharing</h2>
      <p>When you create a share link, anyone who has it can view that summary until you turn it off. Only share material you are allowed to share.</p>

      <h2>Availability and changes</h2>
      <p>The Service is provided &quot;as is&quot; and &quot;as available&quot;. We work to keep it running but do not promise it will be uninterrupted or error-free, and you should keep your own copy of anything you cannot lose (you can export your study packs and download your data at any time).</p>

      <h2>Liability</h2>
      <p>To the extent the law allows, the Service is provided without warranties and we are not liable for indirect or consequential losses, or for loss of data or study results. Nothing in these terms limits liability that cannot be limited by law.</p>

      <h2>Ending your use</h2>
      <p>You can stop at any time and delete your account in Settings, which removes your data. We may suspend or end access for breaking these terms or for legal reasons.</p>

      <h2>Changes to these terms</h2>
      <p>We may update these terms. If a change is significant we will give notice in the app or by email. Continuing to use the Service after a change means you accept it.</p>

      <h2>Privacy</h2>
      <p>How we handle personal data is described in the <a href="/privacy">Privacy Policy</a>.</p>
    </LegalPage>
  );
}
