from pathlib import Path

path = Path("scripts/ingest-krapp-777.py")
s = path.read_text()

old = '''def quantize(variable: str, slab: np.ma.MaskedArray) -> tuple[bytes, dict]:
    values = np.ma.asarray(slab, dtype=float)
    mask = np.ma.getmaskarray(values) | ~np.isfinite(np.ma.filled(values, np.nan))
    filled = np.asarray(np.ma.filled(values, 0.0), dtype=float)
    rule = QUANTIZATION[variable]
'''
new = '''def quantize(variable: str, slab: np.ma.MaskedArray) -> tuple[bytes, dict]:
    values = np.ma.asarray(slab, dtype=float)
    source = np.asarray(np.ma.filled(values, np.nan), dtype=float)
    # The final CDO-produced temperature/cloud files contain the CDO default
    # missing sentinel (~9.96921e36) even though missing_value is NaN. Treat
    # extreme sentinels as missing rather than scientific values.
    mask = np.ma.getmaskarray(values) | ~np.isfinite(source) | (np.abs(source) > 1e20)
    filled = np.where(mask, 0.0, source)
    rule = QUANTIZATION[variable]
'''
assert old in s, "quantize prologue not found"
s = s.replace(old, new, 1)

old = '''    finite_source = np.asarray(values.compressed(), dtype=float)
    stats = {
'''
new = '''    finite_source = source[~mask]
    stats = {
'''
assert old in s, "finite source stats block not found"
s = s.replace(old, new, 1)

old = '''                        "sourceUnits": source_units,
                        "timeCoordinate": matched_time,
'''
new = '''                        "sourceUnitsMetadata": source_units or None,
                        "encodedUnits": QUANTIZATION[variable]["units"],
                        "timeCoordinate": matched_time,
'''
assert old in s, "record source units field not found"
s = s.replace(old, new, 1)

path.write_text(s)
