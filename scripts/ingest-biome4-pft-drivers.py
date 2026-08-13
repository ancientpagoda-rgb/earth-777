#!/usr/bin/env python3
"""Extract the static BIOME4 climate driver needed by PFT eligibility.

BIOME4 4.1 reads `tmin` from inputdata.nc as a signed short and divides it by
10 before applying the PFT climatic constraints. This ingestion preserves the
source int16 values exactly (apart from deterministic grid reordering) so the
runtime can reproduce that operational scaling without copying BIOME4 code.
"""
from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
import shutil
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
ROWS, COLS = 360, 720
CELLS = ROWS * COLS
MISSING = -9999

ASSET_PATH = ROOT / "public/data/biome4-pft-drivers.bin.gz"
META_PATH = ROOT / "src/data/generated/biome4-pft-drivers-meta.generated.js"
MANIFEST_PATH = ROOT / "data/biome4-pft-drivers-manifest.json"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, path: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "earth-777-biome4-pft-driver-ingest/1.0"})
    with urllib.request.urlopen(req, timeout=180) as response, path.open("wb") as out:
        shutil.copyfileobj(response, out, length=8 * 1024 * 1024)


def coord_name(ds: nc.Dataset, aliases: set[str]) -> str:
    for name, var in ds.variables.items():
        if name.lower() in aliases or str(getattr(var, "standard_name", "")).lower() in aliases:
            return name
    raise ValueError(f"Missing coordinate {aliases}")


def main() -> None:
    ASSET_PATH.parent.mkdir(parents=True, exist_ok=True)
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="earth777-biome4-pft-") as tmp:
        tmp = Path(tmp)
        archive = tmp / "biome41.tar.gz"
        download(SOURCE_URL, archive)
        if sha256_file(archive) != SOURCE_ARCHIVE_SHA256:
            raise ValueError("BIOME4 archive checksum changed")
        with tarfile.open(archive, "r:gz") as tar:
            member = tar.getmember("inputdata.nc")
            input_path = tmp / "inputdata.nc"
            with tar.extractfile(member) as source, input_path.open("wb") as target:
                shutil.copyfileobj(source, target)
        if input_path.stat().st_size != INPUTDATA_BYTES or sha256_file(input_path) != INPUTDATA_SHA256:
            raise ValueError("BIOME4 inputdata.nc no longer matches the pinned source")

        with nc.Dataset(input_path) as ds:
            lat = np.asarray(ds.variables[coord_name(ds,{"lat","latitude"})][:], dtype=float)
            lon = np.asarray(ds.variables[coord_name(ds,{"lon","longitude"})][:], dtype=float)
            var = ds.variables["tmin"]
            var.set_auto_mask(False)
            raw = np.asarray(var[:], dtype="<i2")
            declared_units = str(getattr(var, "units", ""))
            missing = int(getattr(var, "missing_value", MISSING))
        if raw.shape != (ROWS, COLS):
            raise ValueError(f"Unexpected tmin shape {raw.shape}")

        lat_order = np.argsort(lat)[::-1]
        norm_lon = ((lon + 180) % 360) - 180
        lon_order = np.argsort(norm_lon)
        standard = raw[lat_order][:, lon_order]
        slat = lat[lat_order]
        slon = norm_lon[lon_order]
        if not np.allclose(np.diff(slat), -0.5, atol=1e-6) or not np.allclose(np.diff(slon), 0.5, atol=1e-6):
            raise ValueError("BIOME4 tmin grid is not regular 0.5 degrees")

        raw_bytes = np.asarray(standard, dtype="<i2").tobytes(order="C")
        if len(raw_bytes) != CELLS * 2:
            raise ValueError("Unexpected tmin payload size")
        compressed = gzip.compress(raw_bytes, compresslevel=9, mtime=0)
        ASSET_PATH.write_bytes(compressed)
        asset_sha = hashlib.sha256(compressed).hexdigest()
        valid = standard[standard != missing].astype(np.int32)

        meta = {
            "id": "biome4-4.1-pft-climate-drivers",
            "rows": ROWS, "cols": COLS,
            "northLatitude": float(slat[0]), "southLatitude": float(slat[-1]),
            "westLongitude": float(slon[0]), "eastLongitude": float(slon[-1]),
            "spacingDegrees": 0.5,
            "tmin": {"dtype": "int16le", "byteOffset": 0, "byteLength": len(raw_bytes), "missingValue": missing,
                     "sourceDeclaredUnits": declared_units, "operationalScaleCelsius": 0.1},
            "asset": "data/biome4-pft-drivers.bin.gz", "assetCompression": "gzip",
            "assetSha256": asset_sha, "compressedBytes": len(compressed), "uncompressedBytes": len(raw_bytes),
            "license": "GPL-2.0-only (transformed input data from upstream BIOME4 4.1 package)",
            "epistemicStatus": "study-constrained static BIOME4 PFT climate driver; source int16 preserved exactly; BIOME4 operationally divides tmin by 10 before climatic constraints"
        }
        META_PATH.write_text("// Generated by scripts/ingest-biome4-pft-drivers.py. Do not edit.\nexport const BIOME4_PFT_DRIVERS_META = Object.freeze(" + json.dumps(meta, indent=2) + ");\n")
        manifest = {
            "schemaVersion": 1, "dataset": "BIOME4 4.1 static PFT climate driver",
            "sourcePackage": SOURCE_URL, "sourcePackageSha256": SOURCE_ARCHIVE_SHA256,
            "inputdataNcSha256": INPUTDATA_SHA256, "inputdataNcBytes": INPUTDATA_BYTES,
            "sourceVariable": {"name": "tmin", "shape": [ROWS,COLS], "dtype": "int16", "declaredUnits": declared_units,
                               "missingValue": missing, "operationalSemantics": "BIOME4 driver divides source short by 10 to obtain degrees Celsius"},
            "validStats": {"rawMinimum": int(valid.min()), "rawMaximum": int(valid.max()),
                           "celsiusMinimum": float(valid.min()/10), "celsiusMaximum": float(valid.max()/10),
                           "validCells": int(valid.size), "missingCells": int(CELLS-valid.size)},
            "preprocessing": "source int16 preserved without quantization; grid reordered north-to-south and longitude -180..180",
            "license": "GPL-2.0-only transformed input data; see data/licenses/BIOME4-GPL-2.0.txt and BIOME4-SOIL-NOTICE.md",
            "output": {"asset": str(ASSET_PATH.relative_to(ROOT)), "assetSha256": asset_sha,
                       "compressedBytes": len(compressed), "uncompressedBytes": len(raw_bytes)}
        }
        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2)+"\n")
        print(json.dumps(manifest["validStats"], indent=2))
        print("asset", asset_sha, len(compressed), len(raw_bytes))

if __name__ == "__main__":
    main()
