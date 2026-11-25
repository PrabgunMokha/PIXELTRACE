"""Image-forensics analyzer template."""

from dataclasses import dataclass
import cv2
import numpy as np

from app.services.image_processing import ProcessedImage

@dataclass(frozen=True)
class ELAResult:
    raw_error: np.ndarray
    ela_map: np.ndarray
    heatmap: np.ndarray
    overlay: np.ndarray
    mean_error:float
    p95_error: float
    p99_error:float
    max_error:float
    high_error_ratio: float
    #Ye define karta hai ki extract_ela() function kya return karega.
    #raw_error: original compression difference
    #ela_map: visible black-and-white ELA map
    #heatmap: coloured ELA result
    #overlay: original image par heatmap
    #mean_error: average compression difference
    #p95_error: 95% pixels is value ke neeche hain
    #p99_error: 99% pixels is value ke neeche hain
    #max_error: sabse bada difference
    #high_error_ratio: unusually bright pixels ka percentage
#frozen=True ka matlab result banne ke baad uski values accidentally replace nahi ki ja sakti.

def _normalize_for_display(
        image: np.ndarray,
        percentile: float = 99.0
) -> np.ndarray:
    """Convert an error image into visible uint8 map."""
#Compression differences normally bahut chhote hote hain, jaise 0, 2, 4 ya 8.
#  Direct display karne par image almost black dikhegi.
#Ye helper function small differences ko 0–255 range mein amplify karega, 
# taaki suspicious pattern visible ho. Function ke naam ke start mein _ batata hai ki ye internal helper hai.

    upper_limit = float(np.percentile(image, percentile))
    
    #Ye image ke 99.5 percentile ko display limit banata hai.
#Agar sirf maximum value use karte aur ek random pixel ka error 255 hota, 
# toh baaki errors bahut dark dikhte. Percentile isolated extreme pixels
#  ko ignore karke useful pattern ko visible rakhta hai.

    if upper_limit <= 0:
        return np.zeros_like(image, dtype=np.uint8)
    #Agar image mein koi compression difference nahi mila, toh upper_limit zero ho sakta hai.
#Zero se division possible nahi hoti. Isliye function same dimensions ki completely 
# black image return karta hai.

    normalized = image.astype(np.float32) / upper_limit

    #Image ko 0.0–1.0 range mein scale karta hai.
    return np.clip(
        normalized * 255,
        0,
        255,
    ).astype(np.uint8)

#Normalized values ko 255 se multiply karke normal image range mein laya jaata hai.
# np.clip() ensure karta hai ki:
# - Negative value 0 se neeche na jaaye.
# - Bright value 255 se upar na jaaye.
# uint8 OpenCV ka standard image-pixel datatype hai.

def extract_ela(
        processed_image: ProcessedImage,
        jpeg_quality: int = 90,
        )-> ELAResult:
    """Extract JPEG compression differences from an image."""
    #jpeg_quality=90 ka matlab image ko temporarily 90-quality JPEG mein compress
    #  karke original se compare kiya jayega.
    if not 1 <= jpeg_quality <= 100:
        raise ValueError("JPEG quality must be between 1 and 100.")
    #JPEG quality valid range 1–100 hai. Agar galti se 0, 120 ya negative number diya,
    #  function clear error dega.
    # Isse OpenCV ko invalid input dene se pehle problem pakdi jaati hai.

    rgb_image = processed_image.rgb
    if rgb_image.dtype != np.uint8:
        raise ValueError("RGB image must be of type uint8.")
    #Uske pixels uint8, yani 0–255, hone chahiye. 
    # Agar normalized 0–1 image accidentally pass ho gayi toh ELA calculation galat hogi,
    #  isliye datatype check kiya gaya hai.

    bgr_image = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2BGR)
    #OpenCV RGB ko BGR format mein convert karta hai, kyunki OpenCV ka

    encode_settings = [
        cv2.IMWRITE_JPEG_QUALITY,
            jpeg_quality,
            ]
    #Ye OpenCV ko batata hai ki JPEG kis quality par compress karna hai.
    # Default value 90 hai, lekin function call ke waqt ise change kiya ja sakta hai.

    success, compressed_byte = cv2.imencode(
        ".jpg",
        bgr_image,
        encode_settings
    )
    #cv2.imencode() image ko disk par file banaye bina memory mein JPEG compress karta hai.
    # - success: compression successful hui ya nahi
    # - compressed_bytes: compressed JPEG data
    # Original image file modify nahi hoti.

    if not success:
        raise RuntimeError("JPEG recompression failed")
    # Agar compression fail ho gayi, toh function error throw karega. Ye rare case hai, 
    # lekin handle karna zaroori hai.

    recompressed_bgr = cv2.imdecode(
        compressed_byte,
        cv2.IMREAD_COLOR
    )
    #Compressed JPEG ko memory se read karke BGR image banata hai.

    if recompressed_bgr is None:
        raise RuntimeError("Recompressed image could not be decoded.")
    #Agar compressed bytes se image read nahi hui, OpenCV None return karega.
    # Ye check invalid image ko next calculations mein jaane se rokta hai.

    recompressed_rgb = cv2.cvtColor(recompressed_bgr, cv2.COLOR_BGR2RGB)
    #Recompressed image OpenCV se BGR format mein mili hai. Original image RGB format mein hai.
    #Comparison se pehle dono ka channel order same hona zaroori hai, 
    #isliye recompressed image ko RGB banaya gaya hai.

    channel_difference = cv2.absdiff(rgb_image, recompressed_rgb)

    raw_error = np.max(
        channel_difference,
        axis=2,
    ).astype(np.float32)
    #RGB channels ke beech maximum difference nikalta hai. Ye original aur recompressed
    # image ke beech compression artifacts ko highlight karta hai.
    
    local_average = cv2.GaussianBlur(
        raw_error,
        (5,5),
        sigmaX=3.0,
    )
    #Gaussian blur har pixel ke aas-paas compression error ka smooth average banata hai.
    #Iska purpose ye samajhna hai ki koi pixel apne neighbouring area se unusually different
    #  hai ya nahi.

    local_anomaly = cv2.absdiff(
        raw_error,
        local_average,
    )
    #Actual error aur surrounding average ke beech difference nikala jaata hai.
    #Agar poori image mein error evenly spread hai, local anomaly low hogi.
    # Agar koi chhota region surroundings se bahut different hai, local anomaly high ho sakti hai.

    visible_error = _normalize_for_display(raw_error)
    visible_anomaly = _normalize_for_display(local_anomaly)
    #Ye dono images ko 0–255 range mein amplify karta hai, taaki human eye
    #  ke liye visible ho sake.

    ela_map = cv2.addWeighted(
        visible_error,
        0.7,
        visible_anomaly, 
        0.30,
        0,
    )
    #Ye dono images ko combine karta hai. 
    # Visible error ko 70% weight aur local anomaly ko 30% weight diya gaya hai.

    heatmap = cv2.applyColorMap(
        ela_map,
        cv2.COLORMAP_TURBO,
    )
    #Ye grayscale ELA map ko color heatmap mein convert karta hai.

    #Dark blue: lower error, Green/yellow: medium error, Red: higher error

    heatmap_overlay = cv2.cvtColor(
        heatmap,
        cv2.COLOR_BGR2RGB
    )
    #Heatmap ko RGB format mein convert karta hai, taaki original image ke saath overlay kiya ja sake.

    overlay = cv2.addWeighted(
        rgb_image,
        0.65,
        heatmap_overlay,
        0.35,
        0,
    )
    #Original image aur heatmap ko combine karta hai. 
    # Original image ko 65% weight aur heatmap ko 35% weight diya gaya hai.

    mean_error = float(np.mean(raw_error))
    p95_error = float(np.percentile(raw_error, 95))
    p99_error = float(np.percentile(raw_error, 99))
    max_error = float(np.max(raw_error))

    #Ye model ke liye numerical forensic features hain.
    #- mean_error: poori image ka average compression change
    #- p95_error: top 5% errors ki boundary
    #- p99_error: top 1% strong errors ki boundary
    #- max_error: strongest individual error
    #Ye amplified heatmap ke bajaye raw_error se calculate ho rahe hain,
    #  isliye values comparatively meaningful rehti hain.

    # A fixed cutoff keeps the high-error metric comparable across images.
    # Before: max(8.0, p95_error) — an image-dependent threshold.
    high_error_threshold = 8.0
    #Ye threshold define karta hai ki kaunse pixels unusually high error
    #  ke liye consider honge.

    high_error_ratio = float(
    np.mean(raw_error >= high_error_threshold) * 100.0
)
    #Ye percentage calculate karta hai ki kitne pixels unusually 
    # high error ke liye responsible hain.

    return ELAResult(
    raw_error=raw_error,
    ela_map=ela_map,
    heatmap=heatmap,
    overlay=overlay,
    mean_error=round(mean_error, 3),
    p95_error=round(p95_error, 3),
    p99_error=round(p99_error, 3),
    max_error=round(max_error, 3),
    high_error_ratio=round(high_error_ratio, 3),
)
    #Ye function ELAResult object return karta hai,
    #  jismein saare calculated images aur numerical features hote hain.

    
