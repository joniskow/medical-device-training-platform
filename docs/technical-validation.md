# Headless technical validation

Install the pinned toolchain/dependencies with `pnpm install --frozen-lockfile`, then run `pnpm typecheck` and `pnpm build` before validation. The runner intentionally does not build: its source fingerprints identify the checked-out tree, while build freshness must be established by the calling CI job. Never use existing local build artifacts as release evidence.

`pnpm test` performs a fresh build and the substantive pure profile; `pnpm lint` runs the source gate. Neither command silently skips empty package scripts. Database, authentication and media/storage profiles remain separate explicit commands below.

Run each profile serially against its stated dependencies:

```powershell
node tools/technical-validation.mjs --profile pure
node tools/technical-validation.mjs --profile auth
node tools/local-test-environment.mjs up
node tools/technical-validation.mjs --profile database
node tools/technical-validation.mjs --profile integration
node tools/technical-validation.mjs --profile infrastructure
```

The `pure` profile uses controlled in-memory adapters, local HTTP servers and synthetic source fixtures; it requires no cloud services or database. The `auth` profile tests controlled signed tokens and SDK doubles, including temporary esbuild files. These checks do not prove a real identity-provider login. The `database` profile uses real local PostgreSQL, migrations and runtime-role permissions. The `integration` profile requires local Azurite and FFmpeg, and checks storage uploads/quarantine and actual scene generation. Profile names describe dependencies, not certification of the entire offering.

Database checks change schema, permissions and fixture data. Run only against a disposable local test database with the documented local roles. Some existing checks hardcode the local URL; setting `DATABASE_URL` alone does not safely redirect every check. The checked-in [local compose file](../infra/local/docker-compose.yml) initializes PostgreSQL on loopback port 54329 and Azurite on loopback port 10000. An existing volume may predate its initialization scripts; verify its runtime role before testing. Do not delete volumes to repair an environment without inspecting their contents and obtaining authorization.

The explicit [manifest](../config/technical-validation.json) is authoritative. Add each new headless regression check to the appropriate profile. Missing/empty manifests, profiles, scripts and duplicate IDs fail validation. Commands execute directly with the current Node executable, argument arrays and no shell. A failing or timed-out check is recorded and later checks still run; the overall process exits nonzero. Each check has a bounded timeout. The runner terminates the direct Node process on timeout; tests that create external processes must also implement their own cleanup. Final source metadata is compared with the initial fingerprint; any change during execution marks the run failed with `VALIDATION_SOURCE_CHANGED_DURING_RUN`.

Evidence is written incrementally to `output/technical-validation/<profile>.json`; use `--evidence path` to retain a unique run in CI. It includes timestamps, source revision, dirty status, a digest of tracked differences, a digest of tracked/unignored source files, manifest/runner/lock/package digests, runtime version, per-check duration/exit status and overall result. Source fingerprints are hashes, not file contents. The evidence excludes child output, environment variables and credentials. Child output still appears in the invoking terminal, so test implementations must redact private data. An interrupted run remains `running` and is not accepted as a pass. Preserve one evidence file per profile together with CI build logs and artifact digests.

The manifest deliberately excludes checks needing supplied content or human inspection. Run `check-training-video-quality.mjs` with a saved lesson/course JSON, and `check-lesson-rough-cut.mjs` with `LESSON_RECORDED_FIXTURE` pointing to real speech. An engineering signal can exercise media processing but cannot establish narration quality. Hosted identity, cloud-provider processing, representative reconstruction, real learner acceptance and independent content/security reviews need separate recorded evidence.

Runner regression command: `node tools/check-technical-validation.mjs`. It exercises valid and invalid manifests, empty scripts, duplicate IDs, success, nonzero exit, timeout, continuation after failure, and structured evidence persistence.

The infrastructure profile requires BICEP_CLI pointing to the official digest-verified Bicep 0.49.2 executable. CI downloads the exact release, verifies its published SHA-256 and compiles every template with no diagnostics; local checks can use the same pinned compiler. This validates template syntax and types, not Azure provisioning or service availability.
