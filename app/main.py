import base64
import json
import platform
import time
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

from app.services.analyzer import extract_ela
from app.services.file_forensics import inspect_file
from app.services.forensic_ontology import build_ela_evidence
from app.services.image_processing import preprocess_image
from app.services.provenance import inspect_provenance
from app.services.spectrum import noise_residual, spectrum_report
from app.services.stress import perturbations

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = PROJECT_ROOT / "models" / "pixeltrace_efficientnet_b0.pth"
EXTENDED_MODEL_PATH = PROJECT_ROOT / "models" / "pixeltrace_v2_efficientnet_b0.pth"
APP_VERSION = "0.3.1"
STARTED_AT = time.monotonic()

app = FastAPI(title="PixelTrace API", version=APP_VERSION)


@app.middleware("http")
async def no_cache_for_pages(request, call_next):
    """The page and its scripts are never cached, so an updated UI always shows up."""
    response = await call_next(request)
    path = request.url.path
    if not path.startswith(("/api", "/docs", "/openapi", "/redoc")):
        response.headers["Cache-Control"] = "no-store"
    return response

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
MAX_BATCH_FILES = 12
model_service = None
extended_service = None


def to_grid(values: np.ndarray, max_side: int, reference: float | None = None) -> dict:
    """Down-sample a 2-D array into a small 0-1 grid used by the 3D evidence viewer."""
    array = np.asarray(values, dtype=np.float32)
    height, width = array.shape[:2]
    scale = max_side / max(height, width)
    grid_width, grid_height = max(2, round(width * scale)), max(2, round(height * scale))
    small = cv2.resize(array, (grid_width, grid_height), interpolation=cv2.INTER_AREA)
    top = float(reference) if reference else float(np.percentile(small, 99))
    normalised = np.clip(small / max(top, 1e-6), 0.0, 1.0)
    return {
        "width": grid_width,
        "height": grid_height,
        "reference": round(top, 4),
        "values": [round(float(v), 3) for v in normalised.ravel()],
    }


def image_to_data_url(image_array: np.ndarray) -> str:
    """Convert an RGB array into a response-safe JPEG data URL."""
    image_buffer = BytesIO()
    Image.fromarray(image_array).save(image_buffer, format="JPEG", quality=90)
    encoded_image = base64.b64encode(image_buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded_image}"


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def get_v1():
    global model_service
    if MODEL_PATH.exists():
        from app.services.model_service import ModelService

        if model_service is None:
            model_service = ModelService()
        return model_service
    return None


def get_v2():
    global extended_service
    if EXTENDED_MODEL_PATH.exists():
        from app.services.extended_model import ExtendedModelService

        if extended_service is None:
            extended_service = ExtendedModelService()
        return extended_service
    return None


def build_headline(provenance: dict, model_analysis: dict, extended_analysis: dict | None) -> dict:
    """One headline for the page, decided in a fixed, documented order."""
    flags = []
    if provenance.get("declared_origin"):
        flags.append("metadata")
    if extended_analysis and extended_analysis.get("prediction") == "ai_generated":
        flags.append("extended_classifier")
    if model_analysis.get("prediction") == "ai_generated":
        flags.append("classifier")
    has_model = bool(model_analysis.get("prediction")) or bool(extended_analysis and extended_analysis.get("prediction"))
    labels = {"ai_generated": "AI generated", "ai_edited": "AI edited", "synthetic": "Synthetic"}
    if flags:
        label = labels.get(provenance.get("declared_origin") or "ai_generated", "AI generated")
        return {"status": "ai", "basis": flags[0], "flags": flags, "label": label}
    if has_model:
        return {"status": "real", "basis": "no_signal", "flags": [], "label": "Looks real"}
    return {"status": "unknown", "basis": "forensic_only", "flags": [], "label": "Evidence only"}


def analyze_bytes(file_bytes: bytes, filename: str | None, ela_quality: int = 90, full: bool = True, stress: bool = False) -> dict:
    """The whole pipeline for one image. `full=False` skips the heavy visuals (used by batch mode)."""
    started = time.perf_counter()
    marks: dict[str, float] = {}

    def lap(name: str, since: float) -> float:
        now = time.perf_counter()
        marks[name] = round((now - since) * 1000, 1)
        return now

    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 10 MB or smaller.")
    if not 60 <= ela_quality <= 100:
        raise HTTPException(status_code=422, detail="ELA JPEG quality must be between 60 and 100.")
    try:
        with Image.open(BytesIO(file_bytes)) as opened_image:
            image = opened_image.convert("RGB")
    except (UnidentifiedImageError, OSError) as error:
        raise HTTPException(status_code=400, detail="The uploaded file is not a readable image.") from error

    t = time.perf_counter()
    provenance = inspect_provenance(file_bytes)
    forensics = inspect_file(file_bytes)
    t = lap("file_ms", t)
    processed = preprocess_image(image)
    ela_result = extract_ela(processed, jpeg_quality=ela_quality)
    ela_evidence = build_ela_evidence(
        mean_error=ela_result.mean_error,
        p99_error=ela_result.p99_error,
        high_error_ratio=ela_result.high_error_ratio,
    )
    t = lap("ela_ms", t)

    model_analysis: dict = {
        "status": "model_not_trained",
        "message": "The forensic ELA scan completed, but the AI-image classification model has not been trained yet.",
    }
    gradcam_analysis = None
    gradcam_grid = None
    assessment = {
        "status": "forensic_signal_only",
        "message": "No trained model is available; use the forensic evidence as a lead for review.",
    }

    v1 = get_v1()
    if v1 is not None:
        model_analysis = v1.predict(image)
        t = lap("classifier_ms", t)
        if full:
            from app.services.gradcam import GradCAM

            if v1.model is None:
                raise RuntimeError("The trained model could not be loaded for Grad-CAM.")
            gradcam = GradCAM(v1.model)
            try:
                heatmap, target_class_index = gradcam.generate(v1.prepare_image(image))
                overlay = gradcam.create_overlay(processed.rgb, heatmap)
                gradcam_grid = to_grid(heatmap, 48, reference=1.0)
                gradcam_analysis = {
                    "target_class": v1.class_names[target_class_index],
                    "overlay_data_url": image_to_data_url(overlay),
                    "limitation": "Grad-CAM shows regions that influenced the model prediction. It is not exact fake-region segmentation.",
                }
            finally:
                gradcam.remove_hooks()
            t = lap("gradcam_ms", t)
        if model_analysis["prediction"] == "ai_generated":
            assessment = {"status": "model_output", "message": "The classifier flags this image as AI-generated. ELA and Grad-CAM are shown as supporting evidence."}
        else:
            assessment = {
                "status": "model_output",
                "message": "The classifier flags no AI signal. This is not proof of authenticity: it was trained on one generator (ADM) and does not generalise to unseen generators.",
            }

    extended_analysis = None
    try:
        v2 = get_v2()
        if v2 is not None:
            extended_analysis = v2.predict(image)
            t = lap("extended_ms", t)
    except Exception as error:  # keep the rest of the report available
        extended_analysis = {"status": "unavailable", "message": f"The extended model could not run: {error}"}
    if extended_analysis and extended_analysis.get("prediction") == "ai_generated":
        assessment = {"status": "extended_model_output", "message": "The extended classifier flags this image as AI-generated. Treat it as a lead and check the other signals."}

    if provenance["declared_origin"] is not None:
        origin = {"ai_generated": "AI-generated", "ai_edited": "AI-edited", "synthetic": "synthetic"}[provenance["declared_origin"]]
        hints = ", ".join(provenance["generator_hints"])
        classifier_text = f" Pixel classifier (ADM-trained): {model_analysis['prediction']}." if "prediction" in model_analysis else ""
        assessment = {
            "status": "ai_declared_by_metadata",
            "message": f"File metadata declares this image as {origin}" + (f" (hints: {hints})" if hints else "")
            + ". This is a provenance declaration read from the file, not pixel analysis; it can be stripped or forged." + classifier_text,
        }

    result = {
        "status": "completed",
        "file_name": filename,
        "image": {"width": processed.width, "height": processed.height},
        "ela": {
            "jpeg_quality": ela_quality,
            "mean_error": ela_result.mean_error,
            "p95_error": ela_result.p95_error,
            "p99_error": ela_result.p99_error,
            "max_error": ela_result.max_error,
            "high_error_ratio": ela_result.high_error_ratio,
        },
        "forensic_evidence": [ela_evidence],
        "model_analysis": model_analysis,
        "extended_model_analysis": extended_analysis,
        "headline": build_headline(provenance, model_analysis, extended_analysis),
        "assessment": assessment,
        "provenance": provenance,
        "forensics": forensics,
        "note": "ELA measures JPEG compression inconsistency. It is a forensic signal, not a final authenticity verdict.",
    }

    if full:
        result["ela_overlay_data_url"] = image_to_data_url(ela_result.overlay)
        result["gradcam"] = gradcam_analysis
        t = time.perf_counter()
        spectrum = spectrum_report(processed.rgb)
        residual, residual_heat, residual_mean = noise_residual(processed.rgb)
        result["spectrum"] = spectrum
        result["noise"] = {
            "mean_residual": round(residual_mean, 3),
            "overlay_data_url": image_to_data_url(residual_heat),
            "grid": to_grid(residual, 96),
            "note": "Difference between the image and a 3×3 median-filtered copy. Exploratory, not used in the verdict.",
        }
        result["visuals"] = {
            "ela_grid": to_grid(ela_result.raw_error, 96, reference=max(8.0, ela_result.p99_error)),
            "gradcam_grid": gradcam_grid,
            "noise_grid": result["noise"]["grid"],
            "spectrum_grid": spectrum["grid"],
        }
        t = lap("visuals_ms", t)

        if stress:
            t = time.perf_counter()
            rows = []
            for name, variant in perturbations(image):
                row = {"name": name}
                if v1 is not None:
                    row["v1_p_ai"] = v1.predict(variant)["class_probabilities"]["ai_generated"]
                if extended_analysis and extended_analysis.get("prediction"):
                    row["v2_p_ai"] = get_v2().predict(variant)["class_probabilities"]["ai_generated"]
                rows.append(row)
            threshold = (extended_analysis or {}).get("decision_threshold", 0.5)
            v2_values = [r["v2_p_ai"] for r in rows if "v2_p_ai" in r]
            v1_values = [r["v1_p_ai"] for r in rows if "v1_p_ai" in r]
            result["stress"] = {
                "variants": rows,
                "v2_threshold": threshold,
                "v2_stable": bool(v2_values) and len({v >= threshold for v in v2_values}) == 1,
                "v2_range": round(max(v2_values) - min(v2_values), 3) if v2_values else None,
                "v1_stable": bool(v1_values) and len({v >= 0.5 for v in v1_values}) == 1,
                "note": "Each variant is the same image after a mild degradation. A verdict that flips under mild degradation is fragile.",
            }
            t = lap("stress_ms", t)

    marks["total_ms"] = round((time.perf_counter() - started) * 1000, 1)
    result["timing_ms"] = marks
    return result


def _check_type(file: UploadFile) -> None:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPEG or PNG image.")


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok", "service": "PixelTrace API"}


@app.post("/api/analyze")
async def analyze_uploaded_image(
    file: UploadFile = File(...),
    ela_quality: int = Form(90),
    stress: bool = Form(False),
) -> dict:
    _check_type(file)
    file_bytes = await file.read()
    return analyze_bytes(file_bytes, file.filename, ela_quality=ela_quality, full=True, stress=stress)


@app.post("/api/analyze-batch")
async def analyze_batch(files: list[UploadFile] = File(...), ela_quality: int = Form(90)) -> dict:
    if not files:
        raise HTTPException(status_code=422, detail="Upload at least one image.")
    if len(files) > MAX_BATCH_FILES:
        raise HTTPException(status_code=413, detail=f"Upload at most {MAX_BATCH_FILES} images at a time.")
    started = time.perf_counter()
    results = []
    for file in files:
        try:
            _check_type(file)
            results.append(analyze_bytes(await file.read(), file.filename, ela_quality=ela_quality, full=False))
        except HTTPException as error:
            results.append({"status": "error", "file_name": file.filename, "status_code": error.status_code, "detail": error.detail})
    done = [r for r in results if r["status"] == "completed"]
    summary = {
        "total": len(results),
        "ai": sum(r["headline"]["status"] == "ai" for r in done),
        "real": sum(r["headline"]["status"] == "real" for r in done),
        "unknown": sum(r["headline"]["status"] == "unknown" for r in done),
        "errors": len(results) - len(done),
        "seconds": round(time.perf_counter() - started, 2),
    }
    return {"summary": summary, "results": results}


@app.get("/api/status")
def status() -> dict:
    return {
        "service": "PixelTrace API",
        "version": APP_VERSION,
        "uptime_seconds": round(time.monotonic() - STARTED_AT),
        "python": platform.python_version(),
        "models": {
            "v1_classifier": {"available": MODEL_PATH.exists(), "loaded": model_service is not None},
            "v2_extended_classifier": {"available": EXTENDED_MODEL_PATH.exists(), "loaded": extended_service is not None},
        },
        "limits": {"max_file_mb": MAX_FILE_SIZE_BYTES // (1024 * 1024), "max_batch_files": MAX_BATCH_FILES, "types": sorted(ALLOWED_IMAGE_TYPES)},
        "endpoints": ["/health", "/api/analyze", "/api/analyze-batch", "/api/status", "/api/model-card", "/api/gallery"],
    }


@app.get("/api/gallery")
def gallery() -> dict:
    data = _read_json(PROJECT_ROOT / "static" / "gallery" / "gallery.json") or {"items": []}
    return data


@app.get("/api/model-card")
def model_card() -> dict:
    v1 = _read_json(PROJECT_ROOT / "results" / "test_metrics.json")
    ela = _read_json(PROJECT_ROOT / "results" / "ela_baseline.json")
    v2 = _read_json(PROJECT_ROOT / "results_v2" / "test_metrics.json")
    external = _read_json(PROJECT_ROOT / "static" / "gallery" / "external_check.json")

    def v1_block(key: str) -> dict | None:
        block = (v1 or {}).get(key)
        if not block:
            return None
        return {k: block.get(k) for k in ("n", "accuracy", "precision", "recall", "f1", "roc_auc")} | {"confusion": block.get("confusion_matrix [[TP,FN],[FP,TN]] (positive = ai_generated)")}

    def v2_block(key: str) -> dict | None:
        block = (v2 or {}).get(key)
        if not block:
            return None
        saved = block["threshold_saved"]
        return {"n": block["n"], "accuracy": saved["accuracy"], "precision": saved["precision"], "recall": saved["recall_ai"], "f1": saved["f1"], "roc_auc": block["roc_auc"], "confusion": saved["confusion [[TP,FN],[FP,TN]]"], "by_generator": block.get("by_generator (accuracy at saved threshold)")}

    result = {
        "version": APP_VERSION,
        "models": [
            {"id": "v1", "name": "Paper classifier (V1)", "architecture": "EfficientNet-B0, ImageNet pre-trained, fine-tuned", "trained_on": "One generator: ADM (Tiny-GenImage), 256×256 PNG images against real JPEG photographs",
             "tests": {"adm_held_out": v1_block("test_data"), "midjourney_unseen": v1_block("test_cross")}, "available": MODEL_PATH.exists()},
            {"id": "v2", "name": "Extended classifier (V2)", "architecture": "EfficientNet-B0, ImageNet pre-trained, fine-tuned", "trained_on": "Photo-style images from more than 60 generators (OpenFake). Midjourney and Imagen kept out of training. Format and resolution normalised for both classes.",
             "tests": {"same_generators_held_out": v2_block("test_same"), "unseen_generators": v2_block("test_unseen")}, "available": EXTENDED_MODEL_PATH.exists()},
            {"id": "ela_baseline", "name": "ELA-only baseline", "architecture": "Logistic regression on five ELA statistics", "trained_on": "The same ADM training images as V1",
             "tests": {"adm_held_out": (ela or {}).get("test_data"), "midjourney_unseen": (ela or {}).get("test_cross")}, "available": ela is not None},
        ],
        "external_check": external,
        "limits": [
            "None of the signals proves that an image is real or AI-generated.",
            "Provenance metadata is easy to strip, so finding none is no information.",
            "The classifiers do not cover charts, diagrams, screenshots or heavily edited real photographs.",
            "About one in eight real photographs is flagged as AI by the extended classifier.",
        ],
    }
    try:
        import csv

        with open(PROJECT_ROOT / "results_v2" / "dataset_manifest.csv", newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
        result["models"][1]["training_generators"] = sorted({r["model"] for r in rows if r["split"] == "train" and r["class"] == "ai_generated"})
        result["models"][1]["unseen_generators"] = sorted({r["model"] for r in rows if r["split"] == "test_unseen" and r["class"] == "ai_generated"})
    except Exception:
        pass
    return result


# Keep this mount after API routes; otherwise it intercepts /api/*.
app.mount("/", StaticFiles(directory=PROJECT_ROOT / "static", html=True), name="static")
