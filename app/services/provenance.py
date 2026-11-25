"""File-provenance check: reads AI-origin declarations embedded in the image file.

Some generators (for example OpenAI / ChatGPT, Adobe Firefly) embed a C2PA "Content Credentials"
manifest and/or an XMP/IPTC "digital source type" in the file. This module only READS those
declarations. It does not analyse pixels, it does not verify the C2PA signature, and the metadata
disappears when an image is screenshotted, re-saved or uploaded to many social platforms.
So: a declaration found = strong hint of origin; nothing found = no information (NOT proof of authenticity).
"""

from __future__ import annotations

import re
import struct
import zlib

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
XMP_PNG_KEYWORD = b"XML:com.adobe.xmp"
XMP_JPEG_HEADER = b"http://ns.adobe.com/xap/1.0/\x00"

# IPTC digital source types (cv.iptc.org/newscodes/digitalsourcetype/...)
SOURCE_TYPE_MAP = {
    "trainedalgorithmicmedia": "ai_generated",
    "compositewithtrainedalgorithmicmedia": "ai_edited",
    "algorithmicmedia": "synthetic",
    "compositesynthetic": "synthetic",
}
GENERATOR_HINTS = ["OpenAI", "ChatGPT", "DALL", "gpt-image", "Firefly", "Midjourney", "Gemini", "Imagen"]
_SOURCE_RE = re.compile(rb"digitalsourcetype/([A-Za-z]+)", re.IGNORECASE)


def _png_blobs(data: bytes) -> list[tuple[str, bytes]]:
    blobs, position = [], 8
    while position + 8 <= len(data):
        length = struct.unpack(">I", data[position : position + 4])[0]
        kind = data[position + 4 : position + 8]
        body = data[position + 8 : position + 8 + length]
        if kind == b"caBX":
            blobs.append(("c2pa", body))
        elif kind == b"iTXt" and body.startswith(XMP_PNG_KEYWORD):
            blobs.append(("xmp", body))
        elif kind in (b"tEXt", b"zTXt", b"iTXt"):
            parsed = _png_text(kind, body)
            if parsed:
                blobs.append(("text", parsed))
        if kind == b"IEND":
            break
        position += 12 + length
    return blobs


def _png_text(kind: bytes, body: bytes) -> bytes | None:
    """Return b'keyword\\x00text' for a PNG text chunk (tEXt, zTXt or iTXt)."""
    try:
        keyword, _, rest = body.partition(b"\x00")
        if kind == b"zTXt":
            text = zlib.decompress(rest[1:])
        elif kind == b"iTXt":
            flag, rest = rest[0], rest[2:]
            rest = rest.split(b"\x00", 2)[2] if rest.count(b"\x00") >= 2 else rest
            text = zlib.decompress(rest) if flag == 1 else rest
        else:
            text = rest
        return keyword + b"\x00" + text[:20000]
    except Exception:
        return None


def _tool_parameters(blobs: list[tuple[str, bytes]]) -> list[str]:
    """Generation parameters that image tools write into PNG text chunks."""
    found: list[str] = []
    for kind, body in blobs:
        if kind != "text":
            continue
        keyword, _, text = body.partition(b"\x00")
        key, value = keyword.decode("latin-1").lower(), text.decode("utf-8", "ignore")
        if key == "parameters" and re.search(r"Steps:\s*\d+", value):
            found.append("Stable Diffusion WebUI")
        elif key in ("prompt", "workflow") and value.lstrip().startswith("{") and ("class_type" in value or '"nodes"' in value):
            found.append("ComfyUI")
        elif key == "software" and "novelai" in value.lower():
            found.append("NovelAI")
        elif key in ("invokeai_metadata", "invokeai_graph"):
            found.append("InvokeAI")
        elif key == "sd-metadata":
            found.append("InvokeAI")
    return list(dict.fromkeys(found))


def _jpeg_blobs(data: bytes) -> list[tuple[str, bytes]]:
    blobs, position = [], 2
    while position + 4 <= len(data) and data[position] == 0xFF:
        marker = data[position + 1]
        if marker == 0xDA:  # start of scan: metadata segments are finished
            break
        length = struct.unpack(">H", data[position + 2 : position + 4])[0]
        body = data[position + 4 : position + 2 + length]
        if marker == 0xE1 and body.startswith(XMP_JPEG_HEADER):
            blobs.append(("xmp", body))
        elif marker == 0xEB and body[:2] == b"JP":
            blobs.append(("c2pa", body))
        position += 2 + length
    return blobs


def inspect_provenance(file_bytes: bytes) -> dict:
    if file_bytes.startswith(PNG_SIGNATURE):
        blobs = _png_blobs(file_bytes)
    elif file_bytes.startswith(b"\xff\xd8"):
        blobs = _jpeg_blobs(file_bytes)
    else:
        blobs = []

    c2pa_present = any(kind == "c2pa" for kind, _ in blobs)
    declared = None
    hints: list[str] = []
    tool_parameters = _tool_parameters(blobs)
    if tool_parameters:
        declared = "ai_generated"
        hints += tool_parameters
    for kind, body in blobs:
        if kind == "text":
            continue
        for match in _SOURCE_RE.findall(body):
            mapped = SOURCE_TYPE_MAP.get(match.decode("ascii").lower())
            if mapped == "ai_generated" or (mapped and declared != "ai_generated"):
                declared = mapped
        for name in GENERATOR_HINTS:
            if name.encode().lower() in body.lower() and name not in hints:
                hints.append(name)

    return {
        "c2pa_manifest_present": c2pa_present,
        "metadata_found": bool(blobs),
        "tool_parameters_found": bool(tool_parameters),
        "declared_origin": declared,
        "generator_hints": hints if declared else [],
        "note": (
            "Read from file metadata. The signature is not verified, and metadata can be stripped "
            "or forged. No declaration found means no information, not proof of authenticity."
        ),
    }
