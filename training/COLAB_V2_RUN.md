# PixelTrace V2: Robustness-focused Colab run

Use a T4 GPU runtime. Upload this project ZIP, extract it, and run these commands from the project root:

```python
!pip -q install datasets httpx python-multipart opencv-python-headless
!python training/build_multigen_v2_dataset.py
src = open("training/train_model.py").read()
open("training/train_model_colab_v2.py", "w").write(
    src.replace('torch.device("cpu")', 'torch.device("cuda" if torch.cuda.is_available() else "cpu")')
       .replace('print("Using device: CPU")', 'print("Using device:", "GPU" if torch.cuda.is_available() else "CPU")')
)
!python -u training/train_model_colab_v2.py
```

Then run the existing notebook evaluation cells against `test_data/` and `test_cross/`.

Only replace the V1 checkpoint if the V2 report improves cross-generator performance while preserving an honest held-out evaluation. Do not reuse V1 accuracy values.
