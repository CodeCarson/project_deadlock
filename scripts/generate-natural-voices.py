#!/usr/bin/env python3
"""Developer-only generation: Python/sherpa-onnx and models never ship with the app.

Use sherpa-onnx==1.13.8, soundfile and ffmpeg. Download/extract the checksum-pinned
Supertonic 3 int8 model from the URL in public/voices/NOTICE.txt, then run:
    python scripts/generate-natural-voices.py /path/to/sherpa-onnx-supertonic-3-tts-int8-2026-05-11
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
 "duration_predictor.int8.onnx":"c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db",
 "text_encoder.int8.onnx":"c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff",
 "vector_estimator.int8.onnx":"20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd",
 "vocoder.int8.onnx":"e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152",
 "voice.bin":"67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8",
}
for name, digest in expected.items():
    if hashlib.sha256((model / name).read_bytes()).hexdigest() != digest:
        raise SystemExit(f"Unexpected model checksum: {name}")
catalog = json.loads((root / "config/voice-packs.json").read_text())
phrases = {}
for event in catalog["events"]:
    key, label = event["id"], event["spoken"]
    phrases[f"{key}-ready"] = f"{label} {'are' if key in ['breakables', 'bridge', 'boxes', 'statues'] else 'is'} ready."
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

manifest = json.loads((root / "public/voices/manifest.json").read_text())
manifest["model"] = "Kokoro-82M v1.0 int8 + Supertonic 3 int8"
with tempfile.TemporaryDirectory() as scratch:
    for voice in (v for v in catalog["voices"] if v.get("engine") == "supertonic3"):
        config = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
          supertonic=sherpa_onnx.OfflineTtsSupertonicModelConfig(
            duration_predictor=str(model / "duration_predictor.int8.onnx"),
            text_encoder=str(model / "text_encoder.int8.onnx"),
            vector_estimator=str(model / "vector_estimator.int8.onnx"),
            vocoder=str(model / "vocoder.int8.onnx"),
            tts_json=str(model / "tts.json"), unicode_indexer=str(model / "unicode_indexer.bin"),
            voice_style=str(model / "voice.bin")),num_threads=2,provider="cpu"))
        if not config.validate():
            raise SystemExit("Invalid synthesis configuration")
        tts = sherpa_onnx.OfflineTts(config)
        folder = root / "public/voices" / voice["id"].removeprefix("pack:")
        folder.mkdir(parents=True, exist_ok=True)
        for cue, text in phrases.items():
            generation = sherpa_onnx.GenerationConfig()
            generation.sid = voice["speaker"]
            generation.speed = 1
            generation.num_steps = 16
            generation.extra["lang"] = "en"
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
