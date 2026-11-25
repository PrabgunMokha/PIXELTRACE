"""Shared vocabulary for PixelTrace forensic evidence."""

from enum import Enum


class EvidenceLevel(str, Enum):
    Low = "low"
    Moderate = "moderate"
    High = "high"

    # TODO: Enum fixed valid labels define karta hai. 
    # Isse API kabhi High, high, HIGH jaisi inconsistent values return nahi karegi.


class ForensicSignal(str, Enum):
    JPEGCompression = "jpeg_compression"

    # TODO: ForensicSignal batata hai ki evidence kis type ka hai.

def build_ela_evidence(
    mean_error: float,
    p99_error: float,
    high_error_ratio: float,
) -> dict:

    #Ye thresholds decide karte hain ki evidence level kya hai.

    if high_error_ratio < 0.5 and p99_error <=8:
        evidence_level = EvidenceLevel.Low
        interpretation = (
            "The JPEG compression pattern is broadly consistent."
        )

    elif high_error_ratio < 2.0 and p99_error <= 16:
        evidence_level = EvidenceLevel.Moderate
        interpretation = (
            "Some compression variation was found, but no strong "
            "localised anomaly was found."
        )

    else:
        evidence_level = EvidenceLevel.High
        interpretation = (
            "A stronger compression inconsistency was found. "
            "This region needs additional forensic checks."
        )

    return {
        "signal": ForensicSignal.JPEGCompression.value,
        "category": "image_forensics",
        "evidence_level": evidence_level.value,
        "metrics": {
            "mean_error": mean_error,
            "p99_error": p99_error,
            "high_error_ratio": high_error_ratio,
        },
        "interpretation": interpretation,
        "limitation": (
            "This evidence is ELA only. It does not prove that an image is authentic, manipulated or AI-generated."
        )
    }

    
