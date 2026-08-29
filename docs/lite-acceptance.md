# Earth 777 Lite acceptance harness

Earth 777 Lite uses the project's accepted pass/fail criteria as a versioned contract in `test/lite-acceptance-spec.mjs`.

The browser harness is `test/cdp-lite-acceptance.mjs`. It writes both `earth-777-lite-acceptance.json` and `earth-777-lite-acceptance.md` so a CI run leaves an auditable report rather than a vague "looks fine" result.

## Status meanings

- **PASS** — the canonical criterion was exercised at its accepted threshold.
- **FAIL** — an automated check contradicted the criterion.
- **PROXY_PASS** — CI verified a useful shorter/headless proxy, but the canonical duration, visual judgment, or representative-hardware requirement still needs a full/manual run.
- **UNVERIFIED** — the product does not yet expose enough instrumentation or no representative baseline has been supplied.
- **MANUAL** — visual or fault-injection review is still required.

Canonical project acceptance requires every criterion to become **PASS**. A green GitHub Actions run means the automated CI proxies did not find a regression; it does not silently convert visual/manual criteria into passes.

## CI profile

GitHub Pages CI runs:

```bash
node test/cdp-lite-acceptance.mjs "$WS_ENDPOINT" --profile=ci
```

The CI profile intentionally uses shorter observations because GitHub's headless Chrome uses SwiftShader rather than representative desktop GPU hardware. It covers cached startup, 100x/1000x responsiveness, repeated evolution updates, surface entry/return, ten-viewport-width travel, persistence proxies, twenty zoom cycles, navigation during 100x, a short stability soak, runtime errors, and WebGL context loss.

## Full profile

For canonical timing/performance certification, launch the built app in Chrome with a CDP debugging port and run:

```bash
npm run test:acceptance:lite -- "$WS_ENDPOINT" --profile=full
```

The full profile uses the accepted 5-minute 100x observation and 20-minute soak, and enforces the 55 FPS average / 30 FPS 1% low thresholds on the machine where it is run.

## Recording performance baseline #1

A baseline must come from a known-good full-profile run on representative desktop hardware. Do not use the GitHub Actions SwiftShader result as the canonical baseline.

After a successful full run, record the report:

```bash
npm run baseline:lite
```

This reads `earth-777-lite-acceptance.json`, refuses CI/proxy reports or failed performance/stability runs, and writes `earth-777-lite-baseline.json`. The baseline records the source commit, CPU/platform metadata, average FPS, 1% low FPS, cached-load timing, soak behavior, and 100x/1000x frame-stall measurements.

Future terrain and simulation branches can enforce the accepted <=10% regression budget with:

```bash
npm run test:acceptance:lite:baseline -- "$WS_ENDPOINT" --profile=full
```

Set `EARTH777_LITE_BASELINE_FILE` only if the baseline file has a non-default path. The wrapper passes the stored FPS values into the canonical harness rather than copying numbers by hand.

The baseline is specifically a **performance baseline**, not a declaration that every visual/manual acceptance criterion has passed.

## Still manual by design

Some criteria are intrinsically visual or require deliberate fault injection: chunk seams, readable topography, coherent geological change, LOD popping, lo-fi visual character, failure isolation, and deterministic large-scale geography. The report leaves these visible as manual/unverified rather than pretending that a DOM check certifies them.

The approved development order is documented in `docs/lite-roadmap.md`.
