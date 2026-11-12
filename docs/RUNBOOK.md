# Operations runbook

For whoever is on call. Start with the numbers, then the logs.

## Look first
```bash
curl -s https://app.example.com/api/health/ready                       # 200 = database reachable
curl -s -H "X-Ops-Token: $OPS_TOKEN" https://app.example.com/api/internal/stats | jq   # queue, failures, alerts[]
docker compose -f docker-compose.prod.yml ps                           # which container is unhealthy
docker compose -f docker-compose.prod.yml logs --since 15m api worker  # JSON lines; every line has request_id
```
`alerts` in the stats answer is a list of plain-language problems (empty = healthy). Point your monitor at it: alert when it is non-empty.

## Symptoms
| You see | Likely cause | Do |
|---|---|---|
| Site down, `caddy` logs show certificate errors | DNS not pointing at the server, or ports 80/443 closed | fix DNS/firewall; Caddy retries by itself |
| `/api/health/ready` = 503 | Supabase unreachable or wrong `DATABASE_URL` / pool exhausted | check the Supabase status page; `DB_POOL_MAX`; restart `api` |
| API container restarts, log says `configuration problem(s) block a production start` | missing/unsafe setting | the log lists each one; fix `.env.production`, `up -d` |
| Stats: `oldest_waiting_seconds` growing | workers down or too few | `ps`; `logs worker`; add workers (`--scale worker=3`) |
| Many `failed_system` | AI provider outage/quota, or YouTube blocking | check provider dashboards and keys; jobs retry twice by themselves |
| Users report "daily limit" wrongly | many users behind one address | confirm `TRUST_PROXY=1` and that Caddy sets X-Forwarded-For (it does) |
| Uploads fail with 413 | proxy limit | `request_body max_size` in `deploy/Caddyfile` must be ≥ `MAX_UPLOAD_MB` |
| Sign-in emails not arriving | Supabase built-in sender limit | configure custom SMTP in Supabase Auth |
| Google says "access blocked" | consent screen still in Testing, or redirect URI mismatch | publish the screen; compare the redirect URI exactly |

## Routine
* **Deploy:** Actions > Deploy. **Roll back:** same, previous tag.
* **Add capacity:** `docker compose -f docker-compose.prod.yml up -d --scale worker=N` (or another GPU worker, see DEPLOYMENT 4.3).
* **Rotate a secret:** change it in `.env.production` (and the GitHub secret), then `up -d`. Rotating `STREAM_SIGNING_KEY` only invalidates links that were open (they last minutes).
* **Stuck jobs** are re-queued automatically after `STALE_JOB_SECONDS` (default 20 min).
* **Delete a user on request:** they can do it in Settings. For support: `delete from auth.users where id = '<uuid>'` removes all rows; then remove their files from the Storage bucket.
* **Weekly:** look at Dependabot updates; run `python3 scripts/check_supabase.py`; glance at cost vs `scripts/cost_model.py`.
