import hashlib
import json
import os
import re
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader

try:
    import fitz
    import pytesseract
    from PIL import Image
except ImportError:
    fitz = None
    pytesseract = None
    Image = None


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = ROOT / "fixtures" / "reference"
PDF_PATH = FIXTURE_ROOT / "manual" / "aurora-infusion-controller-manual.pdf"
OUTPUT_PATH = ROOT / "output" / "fixture-import" / "aic-001-document-extraction.json"
ASSET_VERSION_ID = "assetv_aic001_manual"


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def chunks_for_page(page_number: int, text: str) -> list[dict]:
    normalized = normalize(text)
    if not normalized:
        return []
    chunks = []
    for start in range(0, len(normalized), 480):
        end = min(start + 480, len(normalized))
        if end < len(normalized):
            boundary = normalized.rfind(" ", start, end)
            if boundary > start + 120:
                end = boundary
        value = normalized[start:end].strip()
        chunks.append(
            {
                "chunkId": "chunk_" + hashlib.sha256(f"{ASSET_VERSION_ID}:{page_number}:{start}:{value}".encode()).hexdigest()[:16],
                "text": value,
                "citation": {
                    "assetVersionId": ASSET_VERSION_ID,
                    "page": page_number,
                    "charStart": start,
                    "charEnd": end,
                },
            }
        )
    return chunks


def main() -> None:
    reader = PdfReader(str(PDF_PATH))
    ocr_enabled = os.environ.get("DOCUMENT_OCR_ENABLED", "false").lower() == "true"
    ocr_document = fitz.open(str(PDF_PATH)) if ocr_enabled and fitz is not None else None
    warnings = []
    chunks = []
    page_summaries = []
    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        ocr_used = False
        if not text.strip() and ocr_enabled and ocr_document is not None and pytesseract is not None and Image is not None:
            pixmap = ocr_document[page_number - 1].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            text = pytesseract.image_to_string(Image.open(BytesIO(pixmap.tobytes("png"))))
            ocr_used = bool(text.strip())
        page_chunks = chunks_for_page(page_number, text)
        chunks.extend(page_chunks)
        page_summaries.append({"page": page_number, "hasText": bool(page_chunks), "chunkCount": len(page_chunks), "ocrUsed": ocr_used})
        if not page_chunks:
            warning_code = "OCR_UNAVAILABLE" if ocr_enabled and (fitz is None or pytesseract is None or Image is None) else "PAGE_HAS_NO_MACHINE_TEXT"
            warnings.append({"code": warning_code, "severity": "warning", "message": f"Page {page_number} requires OCR or manual review."})

    output = {
        "schemaVersion": "document-extraction.v1",
        "fixtureId": "AIC-001",
        "inputAssetVersionId": ASSET_VERSION_ID,
        "sourcePath": "fixtures/reference/manual/aurora-infusion-controller-manual.pdf",
        "sourceSha256": hashlib.sha256(PDF_PATH.read_bytes()).hexdigest(),
        "status": "READY" if chunks and not warnings else "REVIEW_REQUIRED",
        "pageCount": len(reader.pages),
        "pages": page_summaries,
        "chunks": chunks,
        "warnings": warnings,
        "metrics": {"pageCount": len(reader.pages), "chunkCount": len(chunks)},
        "limitations": ["OCR is opt-in through DOCUMENT_OCR_ENABLED=true and requires the pinned OCR dependencies plus a system Tesseract binary", "tables and images remain linked artifacts for the production adapter"],
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    required = ["intended use", "components", "procedure", "fault", "assessment", "credential"]
    searchable = " ".join(chunk["text"].lower() for chunk in chunks)
    missing = [term for term in required if term not in searchable]
    if missing:
        raise SystemExit(f"Missing required searchable anchors: {', '.join(missing)}")
    print(f"Reference PDF extraction passed: {output['pageCount']} pages, {len(chunks)} cited chunks.")


if __name__ == "__main__":
    main()
