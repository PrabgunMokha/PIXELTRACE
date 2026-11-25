"""File forensics: context signals read from the file itself (EXIF, JPEG quantisation, PNG text, comments).

These are CONTEXT signals. They never change the classifier output. Camera metadata can be added or removed by anyone,
and its absence is normal for screenshots and web images, so nothing here proves that an image is real or AI-generated.
"""

from __future__ import annotations

import io
import re
from typing import Any

from PIL import Image

STANDARD_LUMINANCE_TABLE = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]
AI_TOOL_PATTERNS = {
    "Stable Diffusion WebUI": r"steps:\s*\d+.*sampler",
    "ComfyUI": r"comfyui|\"class_type\"",
    "NovelAI": r"novelai",
    "InvokeAI": r"invokeai",
    "Fooocus": r"fooocus",
    "Midjourney": r"midjourney",
    "DALL·E": r"dall[-·. ]?e",
    "OpenAI": r"openai",
    "Adobe Firefly": r"firefly",
    "Stable Diffusion": r"stable[ -]?diffusion",
}
_EXIF_MAKE, _EXIF_MODEL, _EXIF_SOFTWARE, _EXIF_DESCRIPTION = 271, 272, 305, 270
_EXIF_IFD, _GPS_IFD = 0x8769, 0x8825


def estimate_jpeg_quality(table: list[int] | None) -> int | None:
    """Estimate the libjpeg quality from a luminance table (order-independent, via sorted values)."""
    if not table or len(table) != 64:
        return None
    target = sorted(int(v) for v in table)
    best_error, best_quality = None, None
    for quality in range(1, 101):
        scale = 5000 / quality if quality < 50 else 200 - 2 * quality
        candidate = sorted(max(1, min(255, int((base * scale + 50) // 100))) for base in STANDARD_LUMINANCE_TABLE)
        error = sum(abs(a - b) for a, b in zip(candidate, target))
        if best_error is None or error < best_error:
            best_error, best_quality = error, quality
    return best_quality if best_error is not None and best_error <= 96 else None


def _text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", "ignore")
    return str(value)


def _hints(text: str, where: str) -> list[dict]:
    lowered = text.lower()
    return [{"tool": tool, "where": where} for tool, pattern in AI_TOOL_PATTERNS.items() if re.search(pattern, lowered, re.DOTALL)]


def inspect_file(file_bytes: bytes) -> dict:
    result: dict[str, Any] = {"file_size": len(file_bytes), "exif": {"present": False}, "context_signals": [], "tool_hints": []}
    signals: list[dict] = result["context_signals"]
    try:
        with Image.open(io.BytesIO(file_bytes)) as image:
            image.load()
            result.update(format=image.format, mode=image.mode, width=image.width, height=image.height)
            result["icc_profile"] = "icc_profile" in image.info

            exif = image.getexif()
            if len(exif):
                sub = exif.get_ifd(_EXIF_IFD) if hasattr(exif, "get_ifd") else {}
                make, model = _text(exif.get(_EXIF_MAKE, "")).strip(), _text(exif.get(_EXIF_MODEL, "")).strip()
                camera = " ".join(part for part in (make, model) if part) or None
                software = _text(exif.get(_EXIF_SOFTWARE, "")).strip() or None
                result["exif"] = {
                    "present": True,
                    "camera": camera,
                    "software": software,
                    "taken": _text(sub.get(0x9003, "")).strip() or None,
                    "lens": _text(sub.get(0xA434, "")).strip() or None,
                    "has_gps": bool(exif.get_ifd(_GPS_IFD)) if hasattr(exif, "get_ifd") else False,
                }
                if camera:
                    signals.append({"id": "camera", "level": "hint", "title": "Camera metadata present", "text": f"{camera}. Camera tags can be added or copied, so this is only a weak hint of a camera capture."})
                if software:
                    signals.append({"id": "software", "level": "info", "title": "Software tag", "text": software})
                for key, value in ((_EXIF_SOFTWARE, software), (_EXIF_DESCRIPTION, _text(exif.get(_EXIF_DESCRIPTION, "")))):
                    if value:
                        result["tool_hints"] += _hints(value, "EXIF")
            else:
                signals.append({"id": "no_exif", "level": "info", "title": "No camera metadata", "text": "No EXIF block. Normal for AI images, but equally normal for screenshots, edited images and images from the web."})

            text_chunks = {k: _text(v) for k, v in (getattr(image, "text", {}) or {}).items()}
            if text_chunks:
                result["png_text_keys"] = sorted(text_chunks)[:12]
                for key, value in text_chunks.items():
                    result["tool_hints"] += _hints(f"{key} {value}", f"PNG text '{key}'")
            comment = image.info.get("comment")
            if comment:
                result["comment"] = _text(comment)[:160]
                result["tool_hints"] += _hints(_text(comment), "JPEG comment")

            if image.format == "JPEG" and getattr(image, "quantization", None):
                quality = estimate_jpeg_quality(list(image.quantization.get(0, [])))
                result["jpeg_quality_estimate"] = quality
                text = f"Estimated JPEG quality about {quality} (standard tables)." if quality else "Non-standard quantisation tables (often a phone, an editor or an encoder such as mozjpeg)."
                signals.append({"id": "jpeg_quality", "level": "info", "title": "JPEG compression", "text": text})
            elif image.format == "PNG":
                signals.append({"id": "png", "level": "info", "title": "Lossless PNG", "text": "PNG is lossless, so there is no JPEG history to analyse in the file itself. ELA results on PNG files are harder to interpret."})
    except Exception as error:  # forensics must never break the analysis
        result["error"] = f"File forensics unavailable: {error}"
        return result

    seen, unique = set(), []
    for hint in result["tool_hints"]:
        key = (hint["tool"], hint["where"])
        if key not in seen:
            seen.add(key)
            unique.append(hint)
    result["tool_hints"] = unique
    if unique:
        names = ", ".join(sorted({h["tool"] for h in unique}))
        signals.insert(0, {"id": "tool_hints", "level": "strong", "title": "Generator names in the file", "text": f"The file's own metadata mentions: {names}."})
    return result
