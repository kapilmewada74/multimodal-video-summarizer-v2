# Admin panel, support and shared study sets

How the Contact page, the admin panel and the "Regenerate" rules work, and why. Everything here is additive: no
existing page, endpoint or table changed behaviour except where **section 3** says so.

## 1. Who can do what

| | Visitor / guest | Signed-in person | Sub-admin | Admin |
|---|---|---|---|---|
| Write on the Contact page | yes | yes (details filled in) | yes | yes |
| Open flashcards, quiz, mind map, slides | shared copy | shared copy, or their own | same | same |
| "Regenerate" | no (sign in) | makes **their own** copy | same | same |
| Admin panel | no (plain 404) | no (plain 404) | support screens | everything |
| See full email addresses | | | no (`ab***@gmail.com`) | yes |
| Answer tickets | | | yes | yes |
| Remove a bad **shared** study set | | | yes | yes |
| Suspend an account, change a daily allowance | | | no | yes |
| Queue health, alerts | | | no | yes |
| Grant / change / remove staff, read the audit log | | | no | yes |

The role table lives in code (`backend/summarizer/features/admin/permissions.py`): a role's powers change through a
reviewed deploy. *Who holds* a role changes any time, in **Admin > Staff**, and is audited.

Staff never see what anyone studied: no summaries, transcripts, notes or documents, only account facts and counts.

## 2. Making the first admin

1. The person signs in to the website once (Google), so their account exists. Use an account with 2-step
   verification turned on: Google sign-in means that protects the admin panel too.
2. On a machine with `DATABASE_URL` set:

```bash
python scripts/grant_staff.py --email you@example.com            # dry run
python scripts/grant_staff.py --email you@example.com --apply    # makes them admin
```

After that, admins add everyone else from **Admin > Staff** (admins: a handful, `MAX_ADMINS`, default 5; sub-admins:
as many as needed). The **Admin panel** item then appears in their account menu. Nobody else sees any trace of it.

Guard rails that hold even after a mistake: nobody changes their own role; the last admin cannot be removed or
demoted (checked under a database lock, so two admins acting at once cannot both win); a role only goes to a real
signed-in account; staff accounts cannot be suspended (remove the role first); changes are rate limited (60 per
5 minutes per person).

## 3. Regenerating flashcards, quizzes, mind maps and slides

Problem: these are generated once per video and shared by everyone who has it. "Regenerate" used to **replace the
shared copy for everyone**, so one person (or a script) could change or ruin it for all, and burn AI money doing so.

New rules (`features/outputs/service.py`):

* The shared copy is written **once**, by whoever opens it first, and can never be overwritten by users.
* **Regenerate** by a signed-in account stores a *personal* copy (table `user_outputs`, variant tagged `@mine`). That
  person sees it from then on; everyone else still sees the shared copy. A small bar says so and offers
  **Switch back to the shared version** (`DELETE /api/videos/{id}/outputs/{kind}`, free).
* If no shared copy exists yet, Regenerate simply makes the shared one (nothing to protect).
* Guests cannot regenerate (403 `account_required`): it is a paid action and guests are anonymous.
* Cost control: each regeneration counts toward the daily generation limit (the hard cap), plus 8 per hour per
  account and 1 per 20 seconds per item. A failed or fallback result is shown but never stored.
* A genuinely bad shared copy is removed by staff (**Admin > Videos > Remove shared copy**, with a reason). The next
  person to open it generates a fresh one for everybody. People's own copies, edits and notes are untouched.
* "Use my documents" copies were already private; they use the same table under a different variant, so they never collide.

## 4. Contact us

The button on the home page used to point at nothing (`#app-top`). It now opens **/contact** (also linked from the
footer and the legal pages): name (optional), email, topic, subject (optional), message. No account needed.

Stored in `support_tickets`; staff work them in **Admin > Support**: take a ticket, change status, add a private
note, **reply by email**. A signed-in sender's ticket is linked to their account; deleting an account deletes their
tickets, and "download my data" includes them.

Spam defences (it is the most exposed endpoint): a hidden field only bots fill in, strict size and format checks, at
most 3 links, 5 messages per address and 3 per email per hour, and a daily cap per address in the database.
**Nothing is emailed back automatically**, because the form is open to anyone and an auto-reply would let a stranger
make us email any address. Replies only go out when staff send them.

Optional email: set `RESEND_API_KEY` (already used for notifications) to enable replies, and `SUPPORT_NOTIFY_EMAIL`
to be told by email when a message arrives. Without them tickets still appear in the panel (replies say so clearly).

## 5. Suspending an account

Admin > Users > person > Suspend (a reason is required and kept in the audit log). The API then answers 403
`account_suspended` for that person; the sign-in itself still works, so they see a message and can use Contact us.
The check is cached 30 seconds per server, so it takes effect immediately on the server that handled the click and
within 30 seconds on the others. If the database cannot be reached, requests are let through (an outage must not look
like a ban). Their data is kept; lifting the suspension restores everything.

## 6. The audit log

Every change, and every time someone opens one person's details, is written in the same transaction as the change
(so a change cannot exist without its record). The table refuses UPDATE, DELETE and TRUNCATE through a database
trigger, and has no foreign key to accounts, so deleting a staff account neither breaks nor edits the log. Each row
keeps the person's email and role at that moment and a hashed IP.

## 7. Design choices worth knowing

* **404, not 403** for people who are not staff: the panel does not advertise itself. `/admin` is `noindex` and in `robots.txt`.
* **Masked emails for sub-admins, and no partial-address search**: otherwise typing "a", "ab", ... would reveal the
  addresses they may not see. They search by the full address, an id, or the start of a name.
* **Roles are read from the database on every admin call**, so removing a role works at once.
* **No separate admin site or login.** Same sign-in, same API, one more section; staff are ordinary accounts with a role.
* Left out on purpose until needed: per-person custom permissions, two-person approval, in-app MFA enrolment (use
  Google's 2-step verification), IP allow-lists (put `/admin` and `/api/admin` behind your proxy's allow-list if wanted).

## 8. Deploying this

1. Apply `supabase/migrations/20261115000013_admin_and_support.sql` (already applied to the dev project).
2. Deploy backend and frontend as usual.
3. Make the first admin (section 2). Optional: `SUPPORT_NOTIFY_EMAIL`, `MAX_ADMINS`.
