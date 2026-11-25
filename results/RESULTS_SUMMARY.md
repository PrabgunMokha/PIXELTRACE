# PixelTrace Measured Results

## Training

| Item | Measured value |
|---|---:|
| Training images | 4,000 (2,000 ADM and 2,000 Real) |
| Validation images | 800 |
| Epochs | 8 |
| Best validation weighted F1 | 0.988750 |
| Training time | 387.651 seconds |

## Held-out evaluation

| Test set | Images | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---:|---:|---:|---:|---:|---:|
| ADM test_data | 1,000 | 0.958000 | 0.997826 | 0.918000 | 0.956250 | 0.999256 |
| Midjourney test_cross | 1,000 | 0.506000 | 0.687500 | 0.022000 | 0.042636 | 0.691132 |

## ELA-only logistic-regression baseline

| Test set | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---:|---:|---:|---:|---:|
| ADM test_data | 0.678000 | 0.663603 | 0.722000 | 0.691571 | 0.724988 |
| Midjourney test_cross | 0.732000 | 0.713235 | 0.776000 | 0.743295 | 0.771900 |

The complete raw metrics, prediction files, confusion matrices, robustness table, training log and example panels are in this folder. The runtime was Google Colab on a Tesla T4; see `environment.json`.
