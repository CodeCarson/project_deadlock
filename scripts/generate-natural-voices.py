#!/usr/bin/env python3
"""Developer-only Supertonic 3 clip generation. Models/inference never ship.

Install sherpa-onnx==1.13.8, numpy, soundfile, ffmpeg; use the checksum-pinned
model archive in public/voices/NOTICE.txt. Generate all natural/character packs:
  python scripts/generate-natural-voices.py /path/to/model
Append pack IDs to regenerate only those packs; --cue limits regeneration to
specific cue IDs. Decoded audio peaks are checked to preserve headroom.
Two independent synthesis
workers generate audio; effects are baked into the recordings, never run in-game.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

import numpy as np
import sherpa_onnx
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("model")
parser.add_argument("voices", nargs="*")
parser.add_argument("--cue", nargs="+")
args = parser.parse_args()
MODEL = Path(args.model).resolve()
EXPECTED = {
    "duration_predictor.int8.onnx": "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
    "text_encoder.int8.onnx": "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
    "vector_estimator.int8.onnx": "20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd",
    "vocoder.int8.onnx": "e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152",
    "voice.bin": "67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8",
}
for name, digest in EXPECTED.items():
    if hashlib.sha256((MODEL / name).read_bytes()).hexdigest() != digest:
        raise SystemExit(f"Unexpected model checksum: {name}")
catalog = json.loads((ROOT / "config/voice-packs.json").read_text())
phrases = {}
for event in catalog["events"]:
    key, label = event["id"], event["spoken"]
    verb = "are" if key in ["breakables", "bridge", "boxes", "statues"] else "is"
    phrases[f"{key}-ready"] = f"{label} {verb} ready."
    phrases[f"{key}-soon"] = f"{label} will be ready soon."
    for warning in catalog["warnings"]:
        phrases[f"{key}-in-{warning}"] = f"{label} in {warning} seconds."
    if event.get("respawn"):
        phrases[f"{key}-respawn"] = f"{label} can respawn."
    if event.get("window"):
        phrases[f"{key}-window"] = f"The {label.lower()} window is open."
        phrases[f"{key}-window-soon"] = f"{label} window opens soon."
        for warning in catalog["warnings"]:
            phrases[f"{key}-window-in-{warning}"] = f"{label} window opens in {warning} seconds."


def generate(voice):
    config = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
        supertonic=sherpa_onnx.OfflineTtsSupertonicModelConfig(
            duration_predictor=str(MODEL / "duration_predictor.int8.onnx"),
            text_encoder=str(MODEL / "text_encoder.int8.onnx"),
            vector_estimator=str(MODEL / "vector_estimator.int8.onnx"),
            vocoder=str(MODEL / "vocoder.int8.onnx"),
            tts_json=str(MODEL / "tts.json"),
            unicode_indexer=str(MODEL / "unicode_indexer.bin"),
            voice_style=str(MODEL / "voice.bin")),
        num_threads=2, provider="cpu"))
    if not config.validate():
        raise ValueError("Invalid synthesis configuration")
    tts = sherpa_onnx.OfflineTts(config)
    folder = ROOT / "public/voices" / voice["id"].removeprefix("pack:")
    folder.mkdir(parents=True, exist_ok=True)
    clips = {}
    with tempfile.TemporaryDirectory() as scratch:
        for cue, text in phrases.items():
            if args.cue and cue not in args.cue:
                continue
            generation = sherpa_onnx.GenerationConfig()
            generation.sid = voice["speaker"]
            generation.speed = 1
            generation.num_steps = 16
            generation.extra["lang"] = "en"
            audio = tts.generate(text, generation)
            samples = np.asarray(audio.samples, dtype=np.float32)
            active = np.flatnonzero(np.abs(samples) > 0.008)
            if not active.size:
                raise ValueError(f"Silent clip: {voice['id']} {cue}")
            padding = int(audio.sample_rate * 0.045)
            samples = samples[max(0, active[0] - padding):min(len(samples), active[-1] + padding)]
            samples *= 0.85 / float(np.max(np.abs(samples)))
            wav = Path(scratch) / "cue.wav"
            sf.write(wav, samples, audio.sample_rate, subtype="PCM_16")
            output = folder / f"{cue}.ogg"
            effects = voice.get("filters", "anull") + ",alimiter=limit=0.89:level=false"
            # Lossy encoding can overshoot a sample limiter. Measure the decoded
            # output and, if needed, re-encode the original WAV with headroom.
            gain = 1.0
            for attempt in range(4):
                subprocess.run([
                    "ffmpeg", "-v", "error", "-y", "-i", str(wav),
                    "-af", effects + f",volume={gain:.6f}",
                    "-c:a", "libopus", "-b:a", "48k", "-application", "voip",
                    "-map_metadata", "-1", str(output),
                ], check=True)
                decoded = np.frombuffer(subprocess.check_output([
                    "ffmpeg", "-v", "error", "-i", str(output),
                    "-f", "f32le", "-ac", "1", "pipe:1",
                ]), dtype="<f4")
                decoded_peak = float(np.max(np.abs(decoded)))
                if decoded_peak < 0.98:
                    break
                gain *= 0.94 / decoded_peak
            else:
                raise ValueError(f"Encoded peak is too high: {voice['id']} {cue}")
            duration = float(subprocess.check_output([
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(output),
            ]))
            if not 0.35 < duration < 6:
                raise ValueError(f"Unexpected clip length: {voice['id']} {cue} {duration}")
            clips[str(output.relative_to(ROOT / "public/voices"))] = {
                "text": text, "seconds": round(duration, 3),
                "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            }
        print(f"Generated {len(clips)} clips for {voice['name']}", flush=True)
    return clips


requested = set(args.voices)
if args.cue and set(args.cue) - set(phrases):
    raise SystemExit("Unknown cue")
voices = [v for v in catalog["voices"] if v.get("engine") == "supertonic3" and
          (not requested or v["id"] in requested)]
if requested - {v["id"] for v in voices}:
    raise SystemExit("Unknown or unsupported requested voice ID")
manifest = json.loads((ROOT / "public/voices/manifest.json").read_text())
manifest["model"] = "Kokoro-82M v1.0 int8 + Supertonic 3 int8"
with ThreadPoolExecutor(max_workers=2) as pool:
    for clips in pool.map(generate, voices):
        manifest["clips"].update(clips)
(ROOT / "public/voices/manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
