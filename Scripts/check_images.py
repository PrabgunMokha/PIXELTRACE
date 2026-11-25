"""Batch check: run the full PixelTrace pipeline in process on a folder of images.

Usage (from the project root):   python Scripts/check_images.py <folder_with_real_and_ai_subfolders>
Put real photographs in <folder>/real and AI images in <folder>/ai. It prints one row per image.
Headline rule: file metadata declares AI -> AI; else classifier says AI -> AI; else real (no AI signal).
"""
import asyncio, sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.main import app  # noqa: E402


def headline(body: dict) -> str:
    if body["provenance"]["declared_origin"]:
        return "AI (file metadata)"
    if body["model_analysis"].get("prediction") == "ai_generated":
        return "AI (classifier)"
    return "real (no AI signal)"


async def main(folder: Path) -> None:
    rows = []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://pixeltrace", timeout=600) as client:
        for truth in ("real", "ai"):
            for path in sorted((folder / truth).glob("*")):
                if path.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
                    continue
                mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
                response = await client.post("/api/analyze", files={"file": (path.name, path.read_bytes(), mime)})
                if response.status_code != 200:
                    rows.append((truth, path.name, f"HTTP {response.status_code}", "-", "-", False))
                    continue
                body = response.json()
                shown = headline(body)
                correct = shown.startswith("AI") == (truth == "ai")
                rows.append((truth, path.name, shown, body["provenance"]["declared_origin"] or "-", body["model_analysis"].get("prediction", "-"), correct))
    print(f"{'truth':6s} {'file':40s} {'headline':22s} {'metadata':14s} {'classifier':14s} correct")
    for r in rows:
        print(f"{r[0]:6s} {r[1][:40]:40s} {r[2]:22s} {r[3]:14s} {r[4]:14s} {'YES' if r[5] else 'NO'}")
    for truth in ("real", "ai"):
        group = [r for r in rows if r[0] == truth]
        print(f"{truth}: {sum(r[5] for r in group)} of {len(group)} labelled correctly")


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
