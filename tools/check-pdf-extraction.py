import importlib.util
import re
from io import BytesIO
from pathlib import Path
from pypdf import PdfReader, PdfWriter
spec=importlib.util.spec_from_file_location("extract_pdf", "apps/worker/src/extract-pdf.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
data=Path("fixtures/reference/manual/aurora-infusion-controller-manual.pdf").read_bytes()
result=module.extract(data,"source:test")
assert result["chunks"] and result["pageCount"] == 2
for page_number,page in enumerate(PdfReader(BytesIO(data)).pages,1):
    normalized=re.sub(r"\s+"," ",page.extract_text() or "").strip()
    chunks=[c for c in result["chunks"] if c["citation"]["page"]==page_number]
    assert "".join(c["text"] for c in chunks)==normalized
    for c in chunks:
        cite=c["citation"]
        assert c["text"]==normalized[cite["charStart"]:cite["charEnd"]]
assert module.extract(data,"source:test")==result
blank=PdfWriter();blank.add_blank_page(width=100,height=100)
buffer=BytesIO();blank.write(buffer)
assert module.extract(buffer.getvalue(),"blank")["emptyPages"]==[1]
blank.encrypt("secret");buffer=BytesIO();blank.write(buffer)
assert module.extract(buffer.getvalue(),"locked")["error"]=="PDF_ENCRYPTED"
print("PDF extraction passed: exact page text/offsets without skipped words, stable IDs, empty-page detection and encrypted-file rejection.")
