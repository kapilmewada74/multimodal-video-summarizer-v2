#!/usr/bin/env python3
"""Compare Whisper model sizes on YOUR media, to choose the model and GPU (Phase 5).

    python3 scripts/benchmark_whisper.py lecture1.mp4 lecture2.mp3 --models small,medium,large-v3
    python3 scripts/benchmark_whisper.py talk.mp3 --reference talk.txt --models base,small

For each model it reports: load time, transcription time, real-time factor (RTF:
transcription seconds per second of audio; 0.1 = ten times faster than playback),
peak memory, and, when a reference transcript is given, the word error rate (WER, lower is better).
The last lines turn this into a recommendation and a throughput figure for capacity planning.

Run it ON the machine you are considering (the CPU box, or the GPU server): the numbers belong to the hardware.
"""
import argparse
import json
import re
import resource
import subprocess
import sys
import time
from pathlib import Path


def audio_seconds(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def normalize(text: str) -> list[str]:
    return re.sub(r"[^\w\s']", " ", text.lower()).split()


def wer(reference: str, hypothesis: str) -> float:
    """Word error rate = (substitutions + deletions + insertions) / reference words."""
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i]
        for j, h in enumerate(hyp, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h)))
        prev = cur
    return prev[-1] / len(ref)


def peak_memory_mb() -> float:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / (1024 * 1024) if sys.platform == "darwin" else peak / 1024


def detect_device() -> tuple[str, str]:
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def run_model(name: str, files: list[Path], references: dict, device: str, compute: str, beam: int) -> dict:
    from faster_whisper import WhisperModel

    started = time.perf_counter()
    model = WhisperModel(name, device=device, compute_type=compute)
    load_s = time.perf_counter() - started

    total_audio = total_time = 0.0
    errors = []
    for path in files:
        seconds = audio_seconds(path)
        started = time.perf_counter()
        segments, info = model.transcribe(str(path), beam_size=beam, vad_filter=True)
        text = " ".join(s.text.strip() for s in segments)  # consuming the generator is what does the work
        elapsed = time.perf_counter() - started
        total_audio += seconds
        total_time += elapsed
        if path in references:
            errors.append(wer(references[path], text))
        print(f"    {path.name}: {seconds:6.1f}s audio in {elapsed:6.1f}s  (language {info.language})", flush=True)
    result = {
        "model": name, "device": device, "load_s": round(load_s, 1), "audio_s": round(total_audio, 1),
        "transcribe_s": round(total_time, 1), "rtf": round(total_time / total_audio, 3) if total_audio else None,
        "peak_mb": round(peak_memory_mb()), "wer": round(sum(errors) / len(errors), 3) if errors else None,
    }
    del model
    return result


def recommend(results: list[dict], max_rtf: float, wer_tolerance: float) -> str:
    usable = [r for r in results if r["rtf"] is not None and r["rtf"] <= max_rtf]
    if not usable:
        return f"No model reached RTF <= {max_rtf} on this machine: use a smaller model or a GPU."
    scored = [r for r in usable if r["wer"] is not None]
    if scored:
        best = min(r["wer"] for r in scored)
        # The fastest model whose accuracy is within the tolerance of the best one.
        pick = min((r for r in scored if r["wer"] <= best + wer_tolerance), key=lambda r: r["rtf"])
        return f"Recommended: {pick['model']} (WER {pick['wer']:.1%}, RTF {pick['rtf']}). Fastest model within {wer_tolerance:.0%} of the best accuracy."
    pick = max(usable, key=lambda r: ["tiny", "base", "small", "medium", "large-v3"].index(r["model"]) if r["model"] in ["tiny", "base", "small", "medium", "large-v3"] else 0)
    return f"Recommended: {pick['model']} (largest model that is fast enough; add --reference for an accuracy-based choice)."


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("media", nargs="+", type=Path, help="audio or video files to transcribe")
    ap.add_argument("--models", default="small,medium,large-v3", help="comma-separated model names")
    ap.add_argument("--reference", type=Path, help="a correct transcript (.txt) of the FIRST file, to measure accuracy")
    ap.add_argument("--beam", type=int, default=5, help="beam size (default 5)")
    ap.add_argument("--max-rtf", type=float, default=0.5, help="slowest acceptable real-time factor (default 0.5)")
    ap.add_argument("--wer-tolerance", type=float, default=0.02, help="accept a model this much worse than the best (default 0.02)")
    ap.add_argument("--json", type=Path, help="also write the results to this file")
    args = ap.parse_args()

    for path in args.media:
        if not path.exists():
            sys.exit(f"File not found: {path}")
    refs = {args.media[0]: args.reference.read_text(encoding="utf-8")} if args.reference else {}
    device, compute = detect_device()
    print(f"Device: {device} ({compute}); {len(args.media)} file(s); beam {args.beam}\n")

    results = []
    for name in [m.strip() for m in args.models.split(",") if m.strip()]:
        print(f"== {name}", flush=True)
        try:
            results.append(run_model(name, args.media, refs, device, compute, args.beam))
        except Exception as exc:  # e.g. out of memory on a big model: report it and go on
            print(f"    failed: {exc}")
            results.append({"model": name, "device": device, "error": str(exc), "rtf": None, "wer": None})

    print(f"\n{'model':<10}{'load s':>8}{'audio s':>9}{'time s':>8}{'RTF':>8}{'peak MB':>9}{'WER':>8}")
    for r in results:
        if r.get("error"):
            print(f"{r['model']:<10}  failed: {r['error'][:60]}")
            continue
        wer_text = f"{r['wer']:.1%}" if r["wer"] is not None else "-"
        print(f"{r['model']:<10}{r['load_s']:>8}{r['audio_s']:>9}{r['transcribe_s']:>8}{r['rtf']:>8}{r['peak_mb']:>9}{wer_text:>8}")

    print("\n" + recommend(results, args.max_rtf, args.wer_tolerance))
    ok = [r for r in results if r.get("rtf")]
    if ok:
        pick = min(ok, key=lambda r: r["rtf"])
        print(f"Capacity: at RTF {pick['rtf']} one worker transcribes about {1 / pick['rtf']:.1f} hours of audio per hour "
              f"(model {pick['model']}). Videos with captions skip this step entirely.")
    if args.json:
        args.json.write_text(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
