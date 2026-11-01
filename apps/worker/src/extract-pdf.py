import hashlib
import json
import re
import sys
import csv
import subprocess
import tempfile
import time
from pathlib import Path
from io import BytesIO
from pypdf import PdfReader

def ocr_page(source, number, directory, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError()
    prefix = str(Path(directory) / "page")
    subprocess.run(["pdftoppm", "-f", str(number), "-l", str(number), "-singlefile", "-scale-to", "2400", "-png", str(source), prefix], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=min(15, remaining))
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError()
    output = subprocess.run(["tesseract", prefix + ".png", "stdout", "-l", "eng", "tsv"], check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=min(15, remaining))
    rows = [row for row in csv.DictReader(output.stdout.decode("utf-8", errors="replace").splitlines(), delimiter="\t") if row.get("level") == "5" and row.get("text", "").strip()]
    text = " ".join(row["text"] for row in rows)
    confidence = sum(float(row["conf"]) for row in rows) / len(rows) if rows else 0
    return text, round(confidence, 2)


def extract(data, asset_id):
    if len(data) > 32 * 1024 * 1024:
        return {"error": "PDF_SIZE_LIMIT"}
    reader = PdfReader(BytesIO(data))
    if reader.is_encrypted:
        return {"error": "PDF_ENCRYPTED"}
    if len(reader.pages) > 200:
        return {"error": "PDF_PAGE_LIMIT"}
    chunks, empty_pages, ocr_pages, warnings = [], [], [], []
    deadline = time.monotonic() + 60
    ocr_count = 0
    characters = 0
    with tempfile.TemporaryDirectory(prefix="pdf-ocr-") as directory:
        source = Path(directory) / "source.pdf"
        source.write_bytes(data)
        for number, page in enumerate(reader.pages, 1):
            text = re.sub(r"\s+", " ", page.extract_text() or "").strip()
            if not text:
                if ocr_count >= 10:
                    warnings.append({"page": number, "code": "PDF_OCR_PAGE_LIMIT"})
                else:
                    ocr_count += 1
                    try:
                        text, confidence = ocr_page(source, number, directory, deadline)
                        text = re.sub(r"\s+", " ", text).strip()
                        ocr_pages.append({"page": number, "meanConfidence": confidence, "language": "eng"})
                        warnings.append({"page": number, "code": "PAGE_OCR_LOW_CONFIDENCE" if confidence < 70 else "PAGE_OCR_REVIEW_REQUIRED"})
                    except FileNotFoundError:
                        warnings.append({"page": number, "code": "PDF_OCR_UNAVAILABLE"})
                    except (TimeoutError, subprocess.TimeoutExpired):
                        warnings.append({"page": number, "code": "PDF_OCR_TIME_LIMIT"})
                    except (subprocess.CalledProcessError, ValueError):
                        warnings.append({"page": number, "code": "PDF_OCR_FAILED"})
            characters += len(text)
            if characters > 2000000:
                return {"error": "PDF_TEXT_LIMIT"}
            if not text:
                empty_pages.append(number)
            start = 0
            while start < len(text):
                end = min(start + 1600, len(text))
                if end < len(text):
                    boundary = text.rfind(" ", start, end)
                    if boundary > start + 400:
                        end = boundary
                value = text[start:end]
                if value.strip():
                    chunk_id = "chunk:" + hashlib.sha256(f"{asset_id}:{number}:{start}:{value}".encode()).hexdigest()
                    chunks.append({"chunkId": chunk_id, "text": value, "citation": {"assetVersionId": asset_id, "page": number, "charStart": start, "charEnd": end}})
                start = end
    return {"pageCount": len(reader.pages), "chunks": chunks, "emptyPages": empty_pages, "ocrPages": ocr_pages, "warnings": warnings}

if __name__ == "__main__":
    try:
        result = extract(sys.stdin.buffer.read(32 * 1024 * 1024 + 1), sys.argv[1])
    except Exception:
        result = {"error": "PDF_EXTRACTION_FAILED"}
    print(json.dumps(result))
