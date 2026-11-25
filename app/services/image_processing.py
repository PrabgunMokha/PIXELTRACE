from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image
@dataclass
class ProcessedImage:
    rgb: np.ndarray
    gray: np.ndarray
    normalized: np.ndarray
    width:int
    height:int
#Ye output ka format define karta hai. Processing ke baad RGB image, grayscale image, normalized image aur final dimensions ek hi ProcessedImage object mein milenge.


def preprocess_image(
        image: Image.Image,
        max_width: int = 1280,
        max_height: int = 1280
        #Ye main preprocessing function hai. Input mein Pillow image lega aur uska maximum processing size 1280 × 1280 rakhega. Return mein ProcessedImage object dega.
) -> ProcessedImage:
        """Prepare an uploaded image for forensic analysis."""
        # Ye function ka description hai. Batata hai ki function uploaded image ko forensic analysis ke liye prepare karta hai.
        rgb_image = image.convert("RGB")
        rgb_array = np.array(rgb_image)
        # Pehli line har uploaded image ko standard three-channel RGB format mein convert karti hai. Doosri line Pillow image ko NumPy pixel array banati hai, kyunki OpenCV arrays par kaam karta hai.
        original_height, original_width = rgb_array.shape[:2]
        #Image ke original height aur width nikalta hai.
        scale = min(
              max_width/original_width,
              max_height/original_height,
              1.0
        )
        #Image ko kitna chhota karna hai, ye calculate karta hai. min() width aur height dono ko limit ke andar rakhta hai. 1.0 image ko unnecessarily bada hone se rokta hai.
        # Example: 4000 × 2000 image ka scale 0.32 hoga aur result 1280 × 640 बनेगा.
        new_width = max(1, int(original_width * scale))
        new_height = max(1, int(original_height * scale))

        # Calculated scale se new width aur height nikalta hai. round() dimensions ko whole number banata hai.

        resized= cv2.resize(
              rgb_array,
              (new_width, new_height),
                interpolation=cv2.INTER_AREA,
        )
        grayscale = cv2.cvtColor(resized, cv2.COLOR_RGB2GRAY)
        #RGB image ki grayscale copy banata hai. Grayscale image texture, edges, noise aur compression differences analyze karne mein useful hai.

        normalized = resized.astype(np.float32) / 255.0
        #Pixel values ko 0–255 se 0.0–1.0 range mein convert karta hai.
        return ProcessedImage(
              rgb = resized,
              gray = grayscale,
              normalized = normalized,
              width = new_width,
              height = new_height
        )
