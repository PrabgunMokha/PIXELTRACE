# Changes made after the report was printed and the paper was published

Unchanged: the V1 checkpoint (models/pixeltrace_efficientnet_b0.pth), every number in the paper and the report, the ELA rules, the training script, and the evaluation results in results/.

Added or changed:

1. app/services/provenance.py (new): reads AI-origin declarations from file metadata (C2PA Content Credentials, XMP/IPTC digital source type). Metadata only: no pixel analysis, signature not verified, nothing found once metadata is stripped.
2. app/main.py: returns a `provenance` field; if the file declares AI origin, the assessment says so. The earlier rule that turned "model real + ELA high" into "needs review" was removed, because ELA statistics overlap strongly between real and AI images (see the paper), so ELA is shown only as supporting evidence.
3. static/app.js: shows "AI generated, declared in file metadata" when a declaration exists.
4. app/services/forensic_ontology.py: spelling, spacing and punctuation of the evidence text only (report finding 1). Thresholds and rules are unchanged.
5. static/ (redesigned): new page with a verdict card, three separate signal cards, an interactive 3D evidence viewer (the photo draped over the ELA or Grad-CAM surface, rotate, zoom, hover values) and a 3D chart of the published evaluation. Three.js is bundled locally in static/vendor, so no internet is needed. app/main.py also returns a `visuals` field (small down-sampled ELA and Grad-CAM grids) for the viewer. No result, threshold or rule changed.
6. Scripts/check_images.py (new): batch check of a folder of real and AI images.
7. app/services/extended_model.py (new, optional): V2 extended classifier. Loads only if a V2 checkpoint exists; no V2 checkpoint is included, so by default the app behaves exactly as before. The V1 model and all paper numbers are unchanged.
8. README.md: rewritten to describe the current state and its limits.
