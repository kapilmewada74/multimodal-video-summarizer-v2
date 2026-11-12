#!/usr/bin/env python3
"""What does one video, and one active user, cost per month?  (Phase 5: "know the cost per user")

Every number below is an ASSUMPTION you must replace with a measured or quoted one:
  - Whisper speed:        run scripts/benchmark_whisper.py on the GPU you will rent (RTF)
  - GPU price:            your provider's hourly price
  - AI token prices:      your provider's price list (per million tokens) and the tokens a video really uses
  - Fixed monthly costs:  Supabase plan, servers, email, domain, monitoring
  - Share with captions:  from your own data (videos with captions skip Whisper entirely)

    python3 scripts/cost_model.py                          # prints the table with the defaults
    python3 scripts/cost_model.py --active-users 2000 --videos-per-user-month 12 --gpu-hourly 0.8 --rtf 0.05
    python3 scripts/cost_model.py --config my_costs.json   # keep your numbers in a file

Output is in USD. The model is deliberately simple so every line can be checked by hand.
"""
import argparse
import json
from dataclasses import asdict, dataclass, field, fields


@dataclass
class Assumptions:
    # ---- usage
    active_users: int = 1000                # users who study in a month
    videos_per_user_month: float = 12.0     # summaries per active user per month (limit is 10 per DAY)
    avg_video_minutes: float = 30.0
    caption_share: float = 0.7              # share of videos with usable captions (no Whisper needed)
    cache_hit_share: float = 0.15           # share of requests for a video someone already summarized (free)
    generations_per_video: float = 2.0      # flashcards / quiz / slides / mind map made per video
    # ---- transcription (only for videos without captions)
    rtf: float = 0.08                       # Whisper seconds per audio second on your GPU (benchmark it)
    gpu_hourly: float = 0.70                # USD per GPU hour
    gpu_utilization: float = 0.35           # share of a rented GPU hour that does useful work (idle time is paid)
    # ---- AI text models
    summary_input_tokens_per_min: float = 160.0   # transcript tokens per video minute (about 150 spoken words)
    summary_output_tokens: float = 1800.0
    generation_input_tokens: float = 3500.0
    generation_output_tokens: float = 1500.0
    price_in_per_m: float = 0.10            # USD per million input tokens
    price_out_per_m: float = 0.40           # USD per million output tokens
    # ---- storage and bandwidth
    storage_gb_per_user: float = 0.4
    storage_price_gb_month: float = 0.021
    egress_gb_per_user: float = 1.0
    egress_price_gb: float = 0.09
    # ---- fixed monthly costs
    fixed: dict = field(default_factory=lambda: {
        "Supabase Pro": 25.0, "API + CPU worker server": 40.0, "Domain/DNS": 2.0,
        "Email (Resend)": 20.0, "Error monitoring + uptime": 15.0})


def compute(a: Assumptions) -> dict:
    videos = a.active_users * a.videos_per_user_month
    fresh = videos * (1 - a.cache_hit_share)                      # videos that actually need processing
    whisper_videos = fresh * (1 - a.caption_share)
    gpu_hours_busy = whisper_videos * a.avg_video_minutes * 60 * a.rtf / 3600
    gpu_cost = gpu_hours_busy / a.gpu_utilization * a.gpu_hourly if a.gpu_utilization else 0.0

    summary_in = a.summary_input_tokens_per_min * a.avg_video_minutes
    per_video_ai = ((summary_in * a.price_in_per_m + a.summary_output_tokens * a.price_out_per_m) / 1e6
                    + a.generations_per_video * (a.generation_input_tokens * a.price_in_per_m
                                                 + a.generation_output_tokens * a.price_out_per_m) / 1e6)
    ai_cost = fresh * per_video_ai
    # Generations are per user, not shared, so cache hits still pay for them.
    ai_cost += (videos - fresh) * a.generations_per_video * (a.generation_input_tokens * a.price_in_per_m
                                                             + a.generation_output_tokens * a.price_out_per_m) / 1e6

    storage = a.active_users * a.storage_gb_per_user * a.storage_price_gb_month
    egress = a.active_users * a.egress_gb_per_user * a.egress_price_gb
    fixed = sum(a.fixed.values())
    total = gpu_cost + ai_cost + storage + egress + fixed
    return {
        "videos_per_month": videos, "fresh_videos": fresh, "whisper_videos": whisper_videos,
        "gpu_busy_hours": gpu_hours_busy,
        "lines": {"GPU transcription": gpu_cost, "AI text models": ai_cost, "Storage": storage,
                  "Bandwidth": egress, "Fixed (plans, servers, email, monitoring)": fixed},
        "total": total,
        "per_user": total / a.active_users if a.active_users else 0.0,
        "per_video": total / videos if videos else 0.0,
        "variable_per_video": (gpu_cost + ai_cost) / videos if videos else 0.0,
    }


def render(a: Assumptions, r: dict) -> str:
    out = [f"{a.active_users:,} active users x {a.videos_per_user_month:g} videos/month = {r['videos_per_month']:,.0f} videos "
           f"({r['fresh_videos']:,.0f} need processing, {r['whisper_videos']:,.0f} need Whisper = {r['gpu_busy_hours']:.1f} busy GPU hours)", ""]
    for name, value in r["lines"].items():
        out.append(f"  {name:<42}{value:>10,.2f}  ({value / r['total']:.0%})" if r["total"] else f"  {name}")
    out += ["  " + "-" * 62, f"  {'TOTAL per month':<42}{r['total']:>10,.2f}", "",
            f"  Cost per active user per month:   ${r['per_user']:.3f}",
            f"  Cost per video (all-in):          ${r['per_video']:.4f}",
            f"  Cost per video (variable only):   ${r['variable_per_video']:.4f}   <- what each extra video costs you", ""]
    for users in (a.active_users // 10 or 1, a.active_users * 10):
        other = compute(Assumptions(**{**asdict(a), "active_users": users}))
        out.append(f"  at {users:>8,} users: ${other['total']:>10,.0f}/month  (${other['per_user']:.3f} per user)")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", help="JSON file with any of the assumptions")
    for f in fields(Assumptions):
        if f.name != "fixed":
            ap.add_argument(f"--{f.name.replace('_', '-')}", type=type(f.default), default=None)
    args = ap.parse_args()
    values = {}
    if args.config:
        with open(args.config) as fh:
            values.update(json.load(fh))
    for f in fields(Assumptions):
        v = getattr(args, f.name, None)
        if v is not None:
            values[f.name] = v
    a = Assumptions(**values)
    print(render(a, compute(a)))
    print("\nThese are ASSUMPTIONS. Replace them with measured values before making decisions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
