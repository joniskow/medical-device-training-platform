import importlib.util
import sys
from io import BytesIO
from pathlib import Path
from pypdf import PdfReader, PdfWriter

spec = importlib.util.spec_from_file_location('extract_pdf', 'apps/worker/src/extract-pdf.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
data = Path(sys.argv[1]).read_bytes()
assert all(not page.extract_text() for page in PdfReader(BytesIO(data)).pages)
result = module.extract(data, 'ocr:reference')
assert result['pageCount'] == 2 and len(result['ocrPages']) == 2, result
assert not result['emptyPages'], result
text = ' '.join(chunk['text'] for chunk in result['chunks']).lower()
assert 'aurora' in text and 'prim' in text and 'line' in text, text
assert all(c['citation']['assetVersionId'] == 'ocr:reference' for c in result['chunks'])
for page in (1, 2):
    chunks = [c for c in result['chunks'] if c['citation']['page'] == page]
    restored = ''.join(c['text'] for c in chunks)
    for chunk in chunks:
        cite = chunk['citation']
        assert restored[cite['charStart']:cite['charEnd']] == chunk['text']
assert module.extract(data, 'ocr:reference') == result
assert all(w['code'].startswith('PAGE_OCR_') for w in result['warnings'])

# Resource-limit decisions are tested without spending time on repeated blank scans.
writer = PdfWriter()
for _ in range(11):
    writer.add_blank_page(width=100, height=100)
buffer = BytesIO()
writer.write(buffer)
module.ocr_page = lambda *args: ('synthetic OCR limit fixture', 99)
limited = module.extract(buffer.getvalue(), 'ocr:limit')
assert len(limited['ocrPages']) == 10 and limited['emptyPages'] == [11]
assert {'page': 11, 'code': 'PDF_OCR_PAGE_LIMIT'} in limited['warnings']
print('OCR passed: real image-only manual, page citations/offsets, repeatable text and IDs, review warnings, and ten-page OCR limit.')
