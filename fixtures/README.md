# Deterministic mock media

These fixtures were generated locally with `pnpm fixtures`: an original geometric portrait image, a 12-second H.264 MP4 of that image, and a quiet 12-second sine tone WAV. No external copyrighted media or model API is involved. All mock model calls return these assets after 200 ms by default; `MOCK_DELAY_MS` can lengthen this for manual failure/cancellation demos.

The asset service measures media with sharp/ffprobe and creates thumbnails. Export really muxes the fixture video/audio using ffmpeg. It does not synthesize a scene, voice, or motion matching the prompt.
