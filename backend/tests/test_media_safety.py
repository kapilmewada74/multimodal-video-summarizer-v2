"""An uploaded file's NAME says nothing: ffmpeg decides what it is from the content, so the content is checked."""
import shutil
import subprocess
import types
import wave
from pathlib import Path

import pytest

from summarizer.features.jobs import runner
from summarizer.features.transcripts import providers
from summarizer.features.transcripts.providers import UnsupportedMedia, check_media_container

HAVE_FFPROBE = shutil.which("ffprobe") is not None


def fake_run(stdout="", returncode=0, calls=None):
    def run(args, **kwargs):
        if calls is not None:
            calls.append(args)
        return types.SimpleNamespace(stdout=stdout, stderr="", returncode=returncode)
    return run


class TestWithPretendTools:
    @pytest.mark.parametrize("names", ["mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm", "avi", "mp3", "wav"])
    def test_real_audio_and_video_containers_pass(self, monkeypatch, names):
        monkeypatch.setattr(providers.subprocess, "run", fake_run(names + "\n"))
        check_media_container(Path("x.bin"))

    @pytest.mark.parametrize("names", ["hls", "concat", "image2", "sdp", "tty", "mov,hls", "applehttp", "rtsp", "data", ""])
    def test_playlists_and_other_formats_are_refused(self, monkeypatch, names):
        monkeypatch.setattr(providers.subprocess, "run", fake_run(names + "\n"))
        with pytest.raises(UnsupportedMedia):
            check_media_container(Path("talk.mp4"))

    def test_an_unreadable_file_is_refused(self, monkeypatch):
        monkeypatch.setattr(providers.subprocess, "run", fake_run("", returncode=1))
        with pytest.raises(UnsupportedMedia):
            check_media_container(Path("x.mp4"))

    def test_a_probe_that_hangs_is_refused(self, monkeypatch):
        def hang(*a, **k):
            raise subprocess.TimeoutExpired("ffprobe", 30)
        monkeypatch.setattr(providers.subprocess, "run", hang)
        with pytest.raises(UnsupportedMedia):
            check_media_container(Path("x.mp4"))

    def test_the_probe_and_the_conversion_may_only_open_local_files(self, monkeypatch, tmp_path):
        calls = []
        monkeypatch.setattr(providers.subprocess, "run", fake_run("mov,mp4,m4a,3gp,3g2,mj2\n", calls=calls))
        monkeypatch.setattr(providers, "media_dirs", lambda: (tmp_path, tmp_path))
        providers.extract_audio(Path("in.mp4"), "job1")
        probe, convert = calls
        assert probe[0] == "ffprobe" and probe[probe.index("-protocol_whitelist") + 1] == "file"
        assert convert[0] == "ffmpeg" and convert[convert.index("-protocol_whitelist") + 1] == "file"
        assert "-nostdin" in convert
        assert convert.index("-protocol_whitelist") < convert.index("-i")      # an input option must come before -i

    def test_nothing_is_converted_when_the_check_fails(self, monkeypatch, tmp_path):
        calls = []
        monkeypatch.setattr(providers.subprocess, "run", fake_run("hls\n", calls=calls))
        monkeypatch.setattr(providers, "media_dirs", lambda: (tmp_path, tmp_path))
        with pytest.raises(UnsupportedMedia):
            providers.extract_audio(Path("talk.mp4"), "job1")
        assert [c[0] for c in calls] == ["ffprobe"]

    def test_the_job_fails_politely_for_the_user(self, monkeypatch):
        monkeypatch.setattr(providers, "extract_audio", lambda *a: (_ for _ in ()).throw(UnsupportedMedia("This is not a supported audio or video file.")))
        with pytest.raises(runner.UserError, match="not a supported"):
            runner._extract_audio_or_refuse(Path("x.mp4"), "j")


@pytest.mark.skipif(not HAVE_FFPROBE, reason="ffprobe is not installed")
class TestWithTheRealTool:
    def test_a_crafted_playlist_named_mp4_is_refused(self, tmp_path):
        evil = tmp_path / "talk.mp4"
        evil.write_text("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n")
        with pytest.raises(UnsupportedMedia):
            check_media_container(evil)

    def test_a_playlist_that_points_at_the_network_is_refused(self, tmp_path):
        evil = tmp_path / "a.wav"
        evil.write_text("#EXTM3U\n#EXTINF:1,\nhttp://169.254.169.254/latest/meta-data/\n")
        with pytest.raises(UnsupportedMedia):
            check_media_container(evil)

    def test_a_text_file_is_refused(self, tmp_path):
        text = tmp_path / "notes.mp3"
        text.write_text("just some words")
        with pytest.raises(UnsupportedMedia):
            check_media_container(text)

    @pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")
    @pytest.mark.parametrize("name,extra", [("clip.mp4", []), ("clip.mkv", []), ("clip.webm", ["-c:v", "libvpx", "-c:a", "libvorbis"]), ("clip.avi", []), ("clip.mov", [])])
    def test_real_video_containers_pass(self, tmp_path, name, extra):
        """Multi-name containers ("mov,mp4,m4a,...") must be read correctly: a first version refused every real MP4."""
        path = tmp_path / name
        made = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                               "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", "-shortest", *extra, str(path)])
        if made.returncode != 0:
            pytest.skip(f"this ffmpeg cannot make {name}")
        check_media_container(path)

    def test_a_real_wav_passes(self, tmp_path):
        good = tmp_path / "tone.wav"
        with wave.open(str(good), "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(16000)
            out.writeframes(b"\x00\x00" * 1600)
        check_media_container(good)
