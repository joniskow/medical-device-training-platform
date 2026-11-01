# Physical device, browser, and performance validation

Local Chromium viewport emulation is regression evidence, not physical-device acceptance. Pilot admission requires one evidence bundle for each named profile in `config/e4-device-matrix.json`:

- iOS/iPadOS Safari with WebGL2;
- Android Chrome with WebGL2; and
- Firefox on the named physical OS/device profile.

Record exact device model, OS build, browser version, viewport, device-pixel ratio, network profile, release/model hashes, and test date. Do not replace a missing physical run with a screenshot from emulation.

## Test protocol

1. Open the deployed release over the pilot network profile with a fresh browser profile and no developer overrides.
2. Start timing at navigation and record the first state in which the approved model, component list, semantic controls, and equivalent path are usable. This must be at or below 5,000 ms.
3. Exercise the representative model path: select a component, perform the required action, complete the activity, reload, and sign out. Record sustained FPS during idle orbit and the representative action path; the acceptance floor is 30 FPS.
4. Run keyboard, touch, screen-reader, zoom/text-scaling, focus, reduced-motion, contrast, live-status, and equivalent-path checks. Non-3D surfaces must meet WCAG 2.2 AA expectations, and certification-critical behavior must remain available without relying on the canvas alone.
5. Trigger WebGL context loss using the browser/device-supported method. Confirm a visible status, bounded recovery attempt, and successful restoration or an explicit reduced-complexity/text equivalent. A silent blank canvas is a failure.
6. Capture ready, error/recovery, and equivalent-path screenshots plus the browser console/network summary. Redact account identifiers and private content.

## Evidence bundle

Each profile uses the `e4-physical-evidence.v1` layout declared in the matrix:

```text
<profile-id>/<run-id>/
  device.json
  performance.json
  accessibility.json
  context-loss.json
  screenshots/ready.png
  screenshots/reduced-or-equivalent.png
```

The bundle is accepted only when all required artifacts exist, the release/model hashes match the candidate release, `interactiveMs <= 5000`, measured FPS is at least 30 for the defined sample, accessibility and equivalent-path checks pass, and context loss is recovered or safely degraded. A pending or failed profile blocks the physical-device pilot sign-off.

The automated local commands remain useful preflight checks:

```powershell
pnpm e4:device-matrix
pnpm e4:budgets
pnpm e4:browser:validate
pnpm e4:context:validate
pnpm e4:headful:measure
```

They do not change the physical acceptance status.
