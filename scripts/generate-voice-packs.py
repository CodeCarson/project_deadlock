#!/usr/bin/env python3
"""Developer-only generation: Python/sherpa-onnx and models never ship with the app.

Use sherpa-onnx==1.13.8, soundfile and ffmpeg. Download/extract the checksum-pinned
Kokoro v1.0 int8 model from the URL in public/voices/NOTICE.txt, then run:
    python scripts/generate-voice-packs.py /path/to/kokoro-int8-multi-lang-v1_0
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np
import sherpa_onnx
import soundfile as sf

root = Path(__file__).resolve().parents[1]
model = Path(sys.argv[1]).resolve()
expected = {
    "model.int8.onnx": "4b86207ef680e394d8343bee22dfc4c512e5c707c6d9578e3f35ab09bffd6b36",
    "voices.bin": "1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29",
}
for name, digest in expected.items():
    if hashlib.sha256((model / name).read_bytes()).hexdigest() != digest:
        raise SystemExit(f"Unexpected model checksum: {name}")
catalog = json.loads((root / "config/voice-packs.json").read_text())
phrases = {}
for event in catalog["events"]:
    key, label = event["id"], event["spoken"]
    phrases[f"{key}-ready"] = f"{label} ready."
    phrases[f"{key}-soon"] = f"{label} soon."
    for warning in catalog["warnings"]:
        phrases[f"{key}-in-{warning}"] = f"{label} in {warning} seconds."
    if event.get("respawn"):
        phrases[f"{key}-respawn"] = f"{label} can respawn."
    if event.get("window"):
        phrases[f"{key}-window"] = f"{label} window open."
        phrases[f"{key}-window-soon"] = f"{label} window opens soon."
        for warning in catalog["warnings"]:
            phrases[f"{key}-window-in-{warning}"] = f"{label} window in {warning} seconds."

manifest = {"model": "Kokoro-82M v1.0 int8", "clips": {}}
with tempfile.TemporaryDirectory() as scratch:
    for voice in catalog["voices"]:
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(model / "model.int8.onnx"),
                    voices=str(model / "voices.bin"),
                    tokens=str(model / "tokens.txt"),
                    data_dir=str(model / "espeak-ng-data"),
                    lexicon=str(model / f"lexicon-{voice['locale']}-en.txt"),
                ),
                num_threads=2,
                provider="cpu",
            )
        )
        if not config.validate():
            raise SystemExit("Invalid synthesis configuration")
        tts = sherpa_onnx.OfflineTts(config)
        folder = root / "public/voices" / voice["id"].removeprefix("pack:")
        folder.mkdir(parents=True, exist_ok=True)
        for cue, text in phrases.items():
            generation = sherpa_onnx.GenerationConfig()
            generation.sid = voice["speaker"]
            generation.speed = 1
            generation.silence_scale = 0.2
            audio = tts.generate(text, generation)
            samples = np.asarray(audio.samples, dtype=np.float32)
            # Trim long leading/trailing silence, preserving natural consonant tails.
            active = np.flatnonzero(np.abs(samples) > 0.008)
            if not active.size:
                raise SystemExit(f"Silent clip: {voice['id']} {cue}")
            padding = int(audio.sample_rate * 0.045)
            samples = samples[max(0, active[0] - padding):min(len(samples), active[-1] + padding)]
            peak = float(np.max(np.abs(samples)))
            samples *= 0.85 / peak
            duration = len(samples) / audio.sample_rate
            if not 0.35 < duration < 6:
                raise SystemExit(f"Unexpected clip length: {voice['id']} {cue} {duration}")
            wav = Path(scratch) / "cue.wav"
            sf.write(wav, samples, audio.sample_rate, subtype="PCM_16")
            output = folder / f"{cue}.ogg"
            subprocess.run([
                "ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libopus",
                "-b:a", "48k", "-application", "voip", "-map_metadata", "-1", str(output),
            ], check=True)
            manifest["clips"][str(output.relative_to(root / "public/voices"))] = {
                "text": text, "seconds": round(duration, 3),
                "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            }
        print(f"Generated {len(phrases)} clips for {voice['name']}", flush=True)
(root / "public/voices/manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
