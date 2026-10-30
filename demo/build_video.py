"""Render a captioned API-trace walkthrough, explicitly NOT a browser recording.

Optional export tooling only: Pillow and imageio-ffmpeg. The app itself has no
Python/video dependency. Run this on the development machine, not a small VPS.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import textwrap

from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
trace_path = ROOT / "api-trace.json"
trace = json.loads(trace_path.read_text(encoding="utf-8"))
assert trace["kind"] == "actual-local-http-execution" and not trace["real_paypal"]
events = {event["step"]: event["detail"] for event in trace["events"]}
suggestion = events["model_suggestion"]["result"]
capture = events["capture"]
trace_hash = hashlib.sha256(trace_path.read_bytes()).hexdigest()

scenes = [
    ("CheckoutLab: suggestions are not authorization", [
        "An offline learning lab for students exploring agentic systems.",
        "A statistical model proposes; a separate system validates.",
        "A human confirms each MOCK checkout step.",
        "This video renders a real local HTTP execution trace.",
        "It is not a browser screen recording or a PayPal integration demo.",
        "Trace SHA256: " + trace_hash[:24],
    ]),
    ("Experiment 1: a small, inspectable local ML model", [
        "GET /api/learn/model -> HTTP 200",
        "Multinomial Naive Bayes, 7 classes, 21 synthetic teaching examples.",
        "POST /api/learn/predict  {text: 'milk coffee'}",
        "Prediction: " + suggestion["sku"],
        "Matched features: " + ", ".join(suggestion["matched_features"]),
        "Log-score separation: " + str(suggestion["log_score_gap"]),
        "This is not a calibrated probability or a production accuracy claim.",
    ]),
    ("Experiment 2: abstain rather than authorize", [
        "Input: spaceship rocket",
        "Model response: " + events["model_abstains"]["result"]["status"],
        "Reason: " + events["model_abstains"]["result"]["reason"],
        "A separate ambiguous checkout request returns HTTP 422.",
        "Reason: " + events["ambiguous_order_rejected"]["result"]["reason"],
        "A model suggestion never creates an order or moves money.",
    ]),
    ("Experiment 3: the server owns the price", [
        "Order: 2 lattes + 1 notebook, from a fixed teaching catalog.",
        "Deliberately submitted client claim: $0.01",
        "Actual server total: $" + format(events["price_authority"]["actual_cents"] / 100, ".2f"),
        "Prices are recomputed in integer cents from server-side data.",
        "The claimed total is audit evidence, never pricing authority.",
        "Order state: draft. No payment has been approved.",
    ]),
    ("Experiment 4: enforce authorization states", [
        "POST capture before approval -> HTTP " + str(events["capture_before_approval_rejected"]["http"]),
        "Then use separate explicit actions:",
        "Confirm -> " + events["confirm"]["state"],
        "Mock buyer approval -> " + events["approve"]["state"],
        "Mock capture -> " + capture["state"],
        "Capture identifier: " + capture["capture_id"],
        "All actions here use the local MOCK adapter. No real funds.",
    ]),
    ("Experiment 5: a retry is not another capture", [
        "POST capture again -> HTTP " + str(events["repeated_capture"]["http"]),
        "Idempotent: " + str(events["repeated_capture"]["idempotent"]),
        "Same capture identifier: " + str(events["repeated_capture"]["same_capture_id"]),
        "The SQLite event trail records each authorization transition.",
        "Regression tests additionally exercise concurrency and isolation.",
        "119 local regression checks passed; fixtures are not a benchmark.",
    ]),
    ("Small default runtime, explicit limits", [
        "No model downloads, API credits, GPU or npm packages are needed.",
        "Observed Node RSS in this one local run: " + str(events["resources"]["observed_rss_mib"]) + " MiB.",
        "This is not a peak bound or a VPS-wide capacity measurement.",
        "Optional external LLM and PayPal Sandbox routes remain unverified.",
        "Data: agent-authored synthetic examples; no real customer dataset.",
        "Implementation: QwenPaw; review and learning extension: Codex.",
    ]),
    ("Reproduce, inspect, and learn", [
        "Node.js 22+ with node:sqlite:",
        "  node server.js",
        "  http://127.0.0.1:8787",
        "  node test/learning.test.js",
        "  node demo/run_demo.js demo/api-trace.json",
        "Source: github.com/gfdy22888-design/paymate-sandbox",
        "Read AI_USAGE.md, the caveats, and the submission checklist.",
    ]),
]

font_candidates = [os.environ.get("CHECKOUTLAB_FONT", ""), "C:/Windows/Fonts/consola.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
font_path = next((p for p in font_candidates if p and Path(p).is_file()), None)
def font(size):
    return ImageFont.truetype(font_path, size) if font_path else ImageFont.load_default(size=size)

W, H = 1280, 720
FPS, SECONDS = 10, 12
output = ROOT / "checkoutlab-demo.mp4"
writer = imageio_ffmpeg.write_frames(str(output), (W, H), fps=FPS, codec="libx264", pix_fmt_in="rgb24", pix_fmt_out="yuv420p", output_params=["-preset", "veryfast", "-crf", "24", "-movflags", "+faststart"], ffmpeg_log_level="error")
writer.send(None)
subtitles = []
def timestamp(seconds):
    return f"{seconds//3600:02}:{seconds//60%60:02}:{seconds%60:02},000"

try:
    for index, (title, lines) in enumerate(scenes):
        image = Image.new("RGB", (W, H), "#102032")
        draw = ImageDraw.Draw(image)
        draw.text((45, 28), "CHECKOUTLAB  /  EDUCATIONAL API WALKTHROUGH", font=font(20), fill="#6ee7b7")
        draw.text((45, 85), title, font=font(28), fill="white")
        y = 155
        for line in lines:
            for wrapped in textwrap.wrap(line, width=84, replace_whitespace=False) or [""]:
                draw.text((48, y), wrapped, font=font(22), fill="#d9e7f5")
                y += 37
        draw.line((45, 628, 1235, 628), fill="#4d657b", width=2)
        draw.text((45, 650), "MOCK PAYMENTS | SYNTHETIC DATA | ACTUAL API TRACE | NOT BROWSER RECORDING", font=font(16), fill="#fbbf24")
        draw.text((1175, 680), f"{index+1}/8", font=font(16), fill="#a6bfd5")
        if index in (0, 1, 4): image.save(ROOT / f"preview-{index+1}.png")
        frame = image.tobytes()
        for _ in range(FPS * SECONDS): writer.send(frame)
        subtitles.append(f"{index+1}\n{timestamp(index*SECONDS)} --> {timestamp((index+1)*SECONDS)}\n{title}\n" + "\n".join(lines) + "\n")
finally:
    writer.close()

(ROOT / "CAPTIONS.en.srt").write_text("\n".join(subtitles), encoding="utf-8")
(ROOT / "VIDEO_INFO.json").write_text(json.dumps({"duration_seconds":len(scenes)*SECONDS,"fps":FPS,"size":[W,H],"kind":"rendered-actual-api-trace-not-browser-recording","trace_sha256":trace_hash,"video_sha256":hashlib.sha256(output.read_bytes()).hexdigest()},indent=2) + "\n", encoding="utf-8")
print(str(output), output.stat().st_size, "bytes", len(scenes)*SECONDS, "seconds")
