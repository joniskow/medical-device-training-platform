# Clean-environment validation

The reproducible gate uses the checked-in `pnpm-lock.yaml`, the workspace package manager declaration, the pinned Python extraction dependencies, deterministic doubles, and the canonical AIC-001 PDF fixture. Run it from a fresh checkout; do not reuse generated `dist` or `output` files as proof of a new run.

## Bootstrap

PowerShell:

```powershell
corepack enable
pnpm install --frozen-lockfile
py -3.13 -m venv .venv
.\.venv\Scripts\python -m pip install --requirement requirements.txt
```

POSIX shells:

```sh
corepack enable
pnpm install --frozen-lockfile
python3.13 -m venv .venv
. .venv/bin/activate
python -m pip install --requirement requirements.txt
```

Use the virtual-environment Python for document extraction. OCR stays disabled unless the run explicitly installs and records the pinned OCR/system-Tesseract prerequisites.

## Gate

```powershell
pnpm clean:validate
```

The gate sets deterministic locale/time-zone inputs and runs, in order: local configuration validation, workspace typecheck, lint, recursive tests, build, document extraction, and a second extraction/hash comparison. A clean run must finish with the same `output/fixture-import/aic-001-document-extraction.json` bytes on both extraction passes.

The command fails on a missing lockfile install, unsupported runtime, missing Python extraction module, lint/type/test/build failure, missing citation artifact, or nondeterministic extraction output. The output artifact is evidence of the run, not a production source-of-truth record.
