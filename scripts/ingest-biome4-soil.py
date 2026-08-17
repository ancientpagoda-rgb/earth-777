#!/usr/bin/env python3
"""Build a compact Earth 777 soil layer from BIOME4's official inputdata.nc.

The official BIOME4 4.1 package is GPL-2.0. This script downloads the package,
verifies the package and input NetCDF hashes, extracts only the two WHC and two
percolation grids used by BIOME4, preserves source float32 values bit-for-bit
apart from deterministic grid reordering, and emits a compact browser asset.

No BIOME4 source code is copied into the Earth 777 application. The transformed
soil data retain the upstream GPL-2.0 terms; the upstream COPYING file is emitted
alongside the manifest by the one-time generation workflow.
"""

from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
import shutil
import struct
import tarfile
import tempfile
import urllib.request

try:
    import netCDF4 as nc
    import numpy as np
except ImportError as exc:
    raise SystemExit("Install ingestion dependencies with: python3 -m pip install netCDF4 numpy") from exc

ROOT = Path(__file__).resolve().parents[1]
SOURCE_URL = "https://pmip2.lsce.ipsl.fr/share/synth/biome4/biome41.tar.gz"
SOURCE_ARCHIVE_SHA256 = "c732b09ead940f10d7f10ac59629ad6e857437b965e10ae923327bc70c3c4a55"
INPUTDATA_SHA256 = "3c6189dddd264aacfe52842c61393a8fa288c3eec0c078d1d5a45d65041dfd15"
INPUTDATA_BYTES = 23_334_032
ROWS = 360
COLS = 720
CELLS = ROWS * COLS

ASSET_PATH = ROOT / "public/data/biome4-soil.bin.gz"
META_PATH = ROOT / "src/data/generated/biome4-soil-meta.generated.js"
MANIFEST_PATH = ROOT / "data/biome4-soil-manifest.json"

STATUS_SOIL = 0
STATUS_WATER_OR_MISSING = 1
STATUS_LAND_ICE = 2
STATUS_BARREN = 3
STATUS_UNKNOWN = 255
STATUS_LABELS = {
    STATUS_SOIL: "soil",
    STATUS_WATER_OR_MISSING: "water-or-missing",
    STATUS_LAND_ICE: "land-ice",
    STATUS_BARREN: "barren",
    STATUS_UNKNOWN: "unknown",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, path: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "earth-777-biome4-soil-ingest/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response, path.open("wb") as output:
        shutil.copyfileobj(response, output, length=8 * 1024 * 1024)


def coordinate_name(ds: nc.Dataset, aliases: set[str]) -> str:
    for name, variable in ds.variables.items():
        if name.lower() in aliases or str(getattr(variable, "standard_name", "")).lower() in aliases:
            return name
    raise ValueError(f"Could not identify coordinate among {sorted(aliases)}")


def source_float32(ds: nc.Dataset, name: str) -> np.ndarray:
    variable = ds.variables[name]
    variable.set_auto_mask(False)
    values = np.asarray(variable[:], dtype="<f4")
    if values.shape != (2, ROWS, COLS):
        raise ValueError(f"Unexpected {name} shape {values.shape}; expected (2,{ROWS},{COLS})")
    return values


def standardize(values: np.ndarray, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lat_order = np.argsort(lat)[::-1]
    normalized_lon = ((lon + 180) % 360) - 180
    lon_order = np.argsort(normalized_lon)
    return values[:, lat_order][:, :, lon_order], lat[lat_order], normalized_lon[lon_order]


def classify(whc_top: np.ndarray) -> np.ndarray:
    status = np.full(whc_top.shape, STATUS_UNKNOWN, dtype="u1")
    status[np.isclose(whc_top, -9999.0)] = STATUS_WATER_OR_MISSING
    status[np.isclose(whc_top, -4.0)] = STATUS_LAND_ICE
    status[np.isclose(whc_top, -1.0)] = STATUS_BARREN
    status[whc_top >= 0] = STATUS_SOIL
    unknown = np.count_nonzero(status == STATUS_UNKNOWN)
    if unknown:
        values = np.unique(whc_top[status == STATUS_UNKNOWN])
        raise ValueError(f"Unrecognized BIOME4 WHC flags: {values[:20].tolist()} ({unknown} cells)")
    return status


def stats(values: np.ndarray, status: np.ndarray, only_soil: bool = True) -> dict:
    selection = values[status == STATUS_SOIL] if only_soil else values.ravel()
    finite = selection[np.isfinite(selection)]
    return {
        "minimum": float(finite.min()) if finite.size else None,
        "maximum": float(finite.max()) if finite.size else None,
        "median": float(np.median(finite)) if finite.size else None,
        "finiteCells": int(finite.size),
    }


def main() -> None:
    ASSET_PATH.parent.mkdir(parents=True, exist_ok=True)
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="earth777-biome4-soil-") as tmp:
        tmp_root = Path(tmp)
        archive = tmp_root / "biome41.tar.gz"
        download(SOURCE_URL, archive)
        archive_sha = sha256_file(archive)
        if archive_sha != SOURCE_ARCHIVE_SHA256:
            raise ValueError(f"BIOME4 archive SHA-256 changed: {archive_sha}")

        with tarfile.open(archive, "r:gz") as tar:
            input_member = tar.getmember("inputdata.nc")
            copying_member = tar.getmember("COPYING")
            input_path = tmp_root / "inputdata.nc"
            copying_path = tmp_root / "COPYING"
            with tar.extractfile(input_member) as source, input_path.open("wb") as target:
                shutil.copyfileobj(source, target)
            with tar.extractfile(copying_member) as source, copying_path.open("wb") as target:
                shutil.copyfileobj(source, target)

        if input_path.stat().st_size != INPUTDATA_BYTES:
            raise ValueError(f"BIOME4 inputdata.nc size changed: {input_path.stat().st_size}")
        input_sha = sha256_file(input_path)
        if input_sha != INPUTDATA_SHA256:
            raise ValueError(f"BIOME4 inputdata.nc SHA-256 changed: {input_sha}")

        with nc.Dataset(input_path) as ds:
            lat_name = coordinate_name(ds, {"lat", "latitude"})
            lon_name = coordinate_name(ds, {"lon", "longitude"})
            lat = np.asarray(ds.variables[lat_name][:], dtype=float)
            lon = np.asarray(ds.variables[lon_name][:], dtype=float)
            whc = source_float32(ds, "whc")
            perc = source_float32(ds, "perc")
            whc_units = str(getattr(ds.variables["whc"], "units", ""))
            perc_units = str(getattr(ds.variables["perc"], "units", ""))
            whc_missing = float(getattr(ds.variables["whc"], "missing_value", -9999.0))
            perc_missing = float(getattr(ds.variables["perc"], "missing_value", -9999.0))

        whc, standard_lat, standard_lon = standardize(whc, lat, lon)
        perc, perc_lat, perc_lon = standardize(perc, lat, lon)
        if not np.array_equal(standard_lat, perc_lat) or not np.array_equal(standard_lon, perc_lon):
            raise ValueError("WHC and percolation grids do not align")
        if standard_lat.shape != (ROWS,) or standard_lon.shape != (COLS,):
            raise ValueError("Unexpected standardized BIOME4 soil coordinate lengths")
        if not np.allclose(np.diff(standard_lat), -0.5, atol=1e-6):
            raise ValueError("BIOME4 latitude grid is not regular 0.5 degrees")
        if not np.allclose(np.diff(standard_lon), 0.5, atol=1e-6):
            raise ValueError("BIOME4 longitude grid is not regular 0.5 degrees")

        status = classify(whc[0])
        soil_mask = status == STATUS_SOIL
        if np.any(whc[:, soil_mask] < 0):
            raise ValueError("Negative WHC found in cells classified as soil")
        if np.any(perc[:, soil_mask] < 0):
            raise ValueError("Negative percolation found in cells classified as soil")

        status_counts = {
            STATUS_LABELS[code]: int(np.count_nonzero(status == code))
            for code in (STATUS_SOIL, STATUS_WATER_OR_MISSING, STATUS_LAND_ICE, STATUS_BARREN, STATUS_UNKNOWN)
        }

        # Layout: status u8, then top/bottom WHC float32 LE, then top/bottom
        # percolation float32 LE. Values are source float32 values, not quantized.
        blocks = [status.tobytes(order="C")]
        offsets = {}
        offset = CELLS
        for field, array in (
            ("whcTop", whc[0]),
            ("whcBottom", whc[1]),
            ("percolationTop", perc[0]),
            ("percolationBottom", perc[1]),
        ):
            offsets[field] = offset
            block = np.asarray(array, dtype="<f4").tobytes(order="C")
            blocks.append(block)
            offset += len(block)
        raw = b"".join(blocks)
        expected_raw = CELLS * (1 + 4 * 4)
        if len(raw) != expected_raw:
            raise ValueError(f"Unexpected raw soil asset size {len(raw)} != {expected_raw}")
        raw_sha = hashlib.sha256(raw).hexdigest()
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        ASSET_PATH.write_bytes(compressed)
        asset_sha = hashlib.sha256(compressed).hexdigest()

        meta = {
            "id": "biome4-4.1-soil-inputs",
            "rows": ROWS,
            "cols": COLS,
            "northLatitude": float(standard_lat[0]),
            "southLatitude": float(standard_lat[-1]),
            "westLongitude": float(standard_lon[0]),
            "eastLongitude": float(standard_lon[-1]),
            "spacingDegrees": 0.5,
            "layers": ["0-30 cm", "30 cm-bottom"],
            "statusLabels": {str(key): value for key, value in STATUS_LABELS.items()},
            "status": {"dtype": "uint8", "byteOffset": 0, "byteLength": CELLS},
            "fields": {
                field: {"dtype": "float32le", "byteOffset": byte_offset, "byteLength": CELLS * 4}
                for field, byte_offset in offsets.items()
            },
            "sourceWhcUnits": whc_units,
            "sourcePercolationUnits": perc_units,
            "sourceMissingValue": whc_missing,
            "asset": "data/biome4-soil.bin.gz",
            "assetCompression": "gzip",
            "assetSha256": asset_sha,
            "uncompressedSha256": raw_sha,
            "uncompressedBytes": len(raw),
            "compressedBytes": len(compressed),
            "license": "GPL-2.0-only (upstream BIOME4 4.1 package)",
            "epistemicStatus": "study-constrained BIOME4 static soil driver; grid reordering/compression only; source code treats WHC -4 as land ice, -1 as barren, and -9999 as missing/water",
        }
        META_PATH.write_text(
            "// Generated by scripts/ingest-biome4-soil.py. Do not edit by hand.\n"
            f"export const BIOME4_SOIL_META = Object.freeze({json.dumps(meta, indent=2)});\n"
        )

        manifest = {
            "schemaVersion": 1,
            "dataset": "BIOME4 4.1 comprehensive driver dataset soil fields",
            "sourcePackage": SOURCE_URL,
            "sourcePackageSha256": SOURCE_ARCHIVE_SHA256,
            "inputdataNcSha256": INPUTDATA_SHA256,
            "inputdataNcBytes": INPUTDATA_BYTES,
            "license": "GPL-2.0-only as distributed in the official BIOME4 4.1 package",
            "sourceVariables": {
                "whc": {"shape": [2, ROWS, COLS], "declaredUnits": whc_units, "missingValue": whc_missing},
                "perc": {"shape": [2, ROWS, COLS], "declaredUnits": perc_units, "missingValue": perc_missing},
            },
            "sourceOperationalSemantics": {
                "whc": "BIOME4 driver passes each layer value directly as layer water-holding capacity; source-code comments call these capacities mm even though inputdata.nc declares mm/m",
                "perc": "BIOME4 passes each layer value directly as the daily percolation coefficient k; daily soil-water code evaluates k * wetness^4 without a 24-hour conversion, despite inputdata.nc declaring mm/hr",
                "flags": {"-9999": "missing/water", "-4": "land ice", "-1": "barren"},
                "otherLargeValues": "999.9 WHC and 999 percolation are not special-cased by BIOME4 and are therefore preserved as numeric model inputs",
            },
            "statusCounts": status_counts,
            "soilStats": {
                "whcTop": stats(whc[0], status),
                "whcBottom": stats(whc[1], status),
                "percolationTop": stats(perc[0], status),
                "percolationBottom": stats(perc[1], status),
            },
            "preprocessing": "source float32 values preserved without quantization; grid reordered north-to-south and longitude -180..180; one uint8 status map derived from documented BIOME4 WHC flags",
            "output": {
                "asset": str(ASSET_PATH.relative_to(ROOT)),
                "assetSha256": asset_sha,
                "uncompressedSha256": raw_sha,
                "compressedBytes": len(compressed),
                "uncompressedBytes": len(raw),
            },
        }
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"Wrote {ASSET_PATH.relative_to(ROOT)}: {len(compressed):,} compressed bytes ({len(raw):,} raw)")
        print("Asset SHA-256:", asset_sha)
        print("Raw SHA-256:", raw_sha)
        print("Status counts:", status_counts)
        print("Soil stats:", manifest["soilStats"])
        print("COPYING SHA-256:", sha256_file(copying_path))


if __name__ == "__main__":
    main()
