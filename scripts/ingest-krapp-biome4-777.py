#!/usr/bin/env python3
"""Extract the published Krapp et al. BIOME4 outputs at exactly 777 ka.

Downloads the 13 original author NetCDFs one at a time, verifies pinned OSF
SHA-256 and byte sizes, extracts only the exact -777000 time coordinate,
standardises the 0.5-degree grid, quantises documented fields, and removes each
large source immediately.
"""

from __future__ import annotations

import gzip
import hashlib
import json
from pathlib import Path
import shutil
import struct
import tempfile
import urllib.request

try:
    import netCDF4 as nc
    import numpy as np
except ImportError as exc:
    raise SystemExit("Install ingestion dependencies with: python3 -m pip install netCDF4 numpy") from exc

ROOT = Path(__file__).resolve().parents[1]
ASSET_PATH = ROOT / "public/data/krapp-777-vegetation.bin.gz"
META_PATH = ROOT / "src/data/generated/krapp-777-vegetation-meta.generated.js"
MANIFEST_PATH = ROOT / "data/vegetation-manifest.json"
TARGET_YEARS_BP = 777_000
ROWS = 360
COLS = 720
CELLS = ROWS * COLS
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

# Original author files in OSF project 8n43x. Each tuple is
# (OSF short download id, SHA-256, exact byte size).
SOURCES = {
    "annual": ("cf5zp", "6690fa535114b148c89cece05457a787fd5163cbcce7cbb4b1b09da528e70d74", 258437709),
    "jan": ("jny87", "205423a17f640c81a5fdd7f97d907621c905cd7e52a2fcc93230a01279d92a88", 71302137),
    "feb": ("dj9e8", "08e21d4f978b24b11c51305522e41d99a8fd293c75c4b4431f74f5f3d3f9ff33", 73906851),
    "mar": ("z2sc7", "ee32af279bfc30e4c6f0071c03f4e9648d47172b257694087a50e87ee1b7d4ef", 82165265),
    "apr": ("29rs8", "fbee8c3fc013f62bb3a643ea6e3e7dabda00f2d6a07e66cb3591a680e719a323", 93483554),
    "may": ("wtgsa", "2cccf21f77188c95ba341e586a67ead385b9164547161e51747c15d4158137d4", 107495782),
    "jun": ("fb3vg", "372ac743d6a5cab5362709b7267d3e3d06e5efcdb73bc64cb51e38d32e1d1503", 109264422),
    "jul": ("gbsj6", "556b17515829aac5b498ef6cfa27f94dbeea4bd919dd9ace863295995ea40646", 108342325),
    "aug": ("dmc94", "9cb928f7af3f1c4895927cbb09c60d159555fef32c4d9e627d6c8836a88398ba", 109311051),
    "sep": ("e3vmr", "a6af2ac79b2ec98cf9130dfcf7c004ed5b8da13237d64c3dd971b95deb199867", 107147771),
    "oct": ("vm7zf", "8818f74da829ff2fcc5d66f6e9e560e05a12ba626e7895bb149c3691b3a085fa", 93272272),
    "nov": ("rm98g", "3843ff707a4376cd1a9de318d4a10f58d1b608124fae20390daf2c667fcad227", 81483249),
    "dec": ("rwthg", "15096e5688d593e0c7aa8b63a4bc4ae8403d34974afa21305242f363d793c118", 73124675),
}

BIOME_MISSING = 255
U16_MISSING = 65535
I16_MISSING = -32768
ANNUAL_NPP_SCALE = 0.1
LAI_SCALE = 0.001
MONTHLY_NPP_SCALE = 0.1

BIOME_LABELS = {
    0: "sea",
    1: "tropical evergreen forest",
    2: "tropical semi-deciduous forest",
    3: "tropical deciduous forest / woodland",
    4: "temperate deciduous forest",
    5: "temperate conifer forest",
    6: "warm mixed forest",
    7: "cool mixed forest",
    8: "cool conifer forest",
    9: "cold mixed forest",
    10: "evergreen taiga / montane forest",
    11: "deciduous taiga / montane forest",
    12: "tropical savanna",
    13: "tropical xerophytic shrubland",
    14: "temperate xerophytic shrubland",
    15: "temperate sclerophyll woodland",
    16: "temperate broadleaved savanna",
    17: "open conifer woodland",
    18: "boreal parkland",
    19: "tropical grassland",
    20: "temperate grassland",
    21: "desert",
    22: "graminoid and forb tundra",
    23: "low- and high-shrub tundra",
    24: "erect dwarf-shrub tundra",
    25: "prostrate dwarf-shrub tundra",
    26: "cushion-forb, lichen and moss tundra",
    27: "barren",
    28: "land ice",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(guid: str, path: Path) -> None:
    request = urllib.request.Request(
        f"https://osf.io/download/{guid}/",
        headers={"User-Agent": "earth-777-biome4-ingest/1.0"},
    )
    with urllib.request.urlopen(request, timeout=240) as response, path.open("wb") as output:
        shutil.copyfileobj(response, output, length=8 * 1024 * 1024)


def coordinate_name(ds: nc.Dataset, axis: str) -> str:
    aliases = {"time": {"time"}, "lat": {"lat", "latitude"}, "lon": {"lon", "longitude"}}[axis]
    for name, variable in ds.variables.items():
        if name.lower() in aliases or str(getattr(variable, "standard_name", "")).lower() in aliases:
            return name
    raise ValueError(f"Could not identify {axis} coordinate")


def exact_time_index(ds: nc.Dataset) -> tuple[str, int, float]:
    name = coordinate_name(ds, "time")
    values = np.asarray(ds.variables[name][:], dtype=float)
    for target in (-TARGET_YEARS_BP, TARGET_YEARS_BP, -TARGET_YEARS_BP / 1000, TARGET_YEARS_BP / 1000):
        hits = np.where(np.isclose(values, target, rtol=0, atol=1e-6))[0]
        if hits.size:
            return name, int(hits[0]), float(values[hits[0]])
    raise ValueError(f"No exact 777 ka coordinate; range {values.min()}..{values.max()}")


def standardize_slab(ds: nc.Dataset, variable_name: str, time_name: str, index: int) -> tuple[np.ma.MaskedArray, np.ndarray, np.ndarray]:
    lat_name = coordinate_name(ds, "lat")
    lon_name = coordinate_name(ds, "lon")
    variable = ds.variables[variable_name]
    dims = list(variable.dimensions)
    selectors = [slice(None)] * len(dims)
    selectors[dims.index(time_name)] = index
    slab = np.ma.asarray(variable[tuple(selectors)])
    remaining = [dim for dim in dims if dim != time_name]
    lat_axis = remaining.index(lat_name)
    lon_axis = remaining.index(lon_name)
    if (lat_axis, lon_axis) != (0, 1):
        slab = np.ma.transpose(slab, (lat_axis, lon_axis))
    lat = np.asarray(ds.variables[lat_name][:], dtype=float)
    lon = np.asarray(ds.variables[lon_name][:], dtype=float)
    lat_order = np.argsort(lat)[::-1]
    normalized_lon = ((lon + 180) % 360) - 180
    lon_order = np.argsort(normalized_lon)
    slab = slab[lat_order][:, lon_order]
    return slab, lat[lat_order], normalized_lon[lon_order]


def masked_float(slab: np.ma.MaskedArray) -> tuple[np.ndarray, np.ndarray]:
    values = np.ma.asarray(slab, dtype=float)
    raw = np.asarray(np.ma.filled(values, np.nan), dtype=float)
    mask = np.ma.getmaskarray(values) | ~np.isfinite(raw) | (np.abs(raw) > 1e20)
    return raw, mask


def stats(raw: np.ndarray, mask: np.ndarray) -> dict:
    finite = raw[~mask]
    return {
        "minimum": float(finite.min()) if finite.size else None,
        "maximum": float(finite.max()) if finite.size else None,
        "finiteCells": int(finite.size),
        "missingCells": int(mask.sum()),
    }


def encode_u16(raw: np.ndarray, mask: np.ndarray, scale: float, label: str) -> bytes:
    finite = raw[~mask]
    if finite.size and finite.min() < -1e-6:
        raise ValueError(f"{label} unexpectedly negative: {finite.min()}")
    encoded = np.rint(np.where(mask, 0, np.maximum(raw, 0)) / scale)
    if np.any(encoded[~mask] >= U16_MISSING):
        raise ValueError(f"{label} exceeds uint16 encoding at scale {scale}")
    out = encoded.astype("<u2")
    out[mask] = U16_MISSING
    return out.tobytes(order="C")


def encode_i16(raw: np.ndarray, mask: np.ndarray, scale: float, label: str) -> bytes:
    encoded = np.rint(np.where(mask, 0, raw) / scale)
    if np.any(encoded[~mask] <= I16_MISSING) or np.any(encoded[~mask] > 32767):
        finite = raw[~mask]
        raise ValueError(f"{label} range {finite.min()}..{finite.max()} exceeds int16 at scale {scale}")
    out = encoded.astype("<i2")
    out[mask] = I16_MISSING
    return out.tobytes(order="C")


def validate_grid(lat: np.ndarray, lon: np.ndarray) -> None:
    if lat.shape != (ROWS,) or lon.shape != (COLS,):
        raise ValueError(f"Unexpected BIOME4 grid {lat.shape} x {lon.shape}")
    if not np.allclose(np.diff(lat), -0.5, atol=1e-6) or not np.allclose(np.diff(lon), 0.5, atol=1e-6):
        raise ValueError("BIOME4 coordinates are not the expected regular 0.5-degree grid")


def source_record(label: str, guid: str, sha256: str, size: int, coordinate: float, field_stats: dict) -> dict:
    filename = "biome4output_800ka.nc" if label == "annual" else f"biome4output_800ka_{label}.nc"
    return {
        "label": label,
        "filename": filename,
        "osfDownloadId": guid,
        "downloadUrl": f"https://osf.io/download/{guid}/",
        "sha256": sha256,
        "bytes": size,
        "timeCoordinate": coordinate,
        "timeSelection": "exact -777000 coordinate",
        "stats": field_stats,
    }


def main() -> None:
    ASSET_PATH.parent.mkdir(parents=True, exist_ok=True)
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)

    annual_blocks: dict[str, bytes] = {}
    monthly_blocks: list[bytes] = []
    records: list[dict] = []
    grid_lat = grid_lon = None
    biome_counts: dict[str, int] = {}

    with tempfile.TemporaryDirectory(prefix="earth777-biome4-") as tmp:
        temp_root = Path(tmp)
        for label in ("annual",) + MONTHS:
            guid, expected_hash, expected_size = SOURCES[label]
            path = temp_root / f"{label}.nc"
            print(f"Downloading {label}: https://osf.io/download/{guid}/", flush=True)
            download(guid, path)
            actual_size = path.stat().st_size
            actual_hash = sha256_file(path)
            if actual_size != expected_size:
                raise ValueError(f"{label} byte size changed: {actual_size} != {expected_size}")
            if actual_hash != expected_hash:
                raise ValueError(f"{label} SHA-256 changed: {actual_hash} != {expected_hash}")

            with nc.Dataset(path) as ds:
                time_name, index, coordinate = exact_time_index(ds)
                if label == "annual":
                    required = ("biome", "npp", "LAI")
                    missing_variables = [name for name in required if name not in ds.variables]
                    if missing_variables:
                        raise ValueError(f"Annual BIOME4 file missing variables {missing_variables}")
                    slabs = {}
                    lat = lon = None
                    for name in required:
                        slab, local_lat, local_lon = standardize_slab(ds, name, time_name, index)
                        validate_grid(local_lat, local_lon)
                        if lat is None:
                            lat, lon = local_lat, local_lon
                        elif not np.array_equal(lat, local_lat) or not np.array_equal(lon, local_lon):
                            raise ValueError("Annual BIOME4 variables do not share one grid")
                        slabs[name] = slab
                    grid_lat, grid_lon = lat, lon

                    biome_raw = np.asarray(np.ma.filled(slabs["biome"], -2147483648), dtype=np.int64)
                    biome_mask = np.ma.getmaskarray(slabs["biome"]) | (biome_raw <= -1_000_000_000)
                    valid_biomes = biome_raw[~biome_mask]
                    invalid_codes = sorted(set(int(value) for value in valid_biomes if value not in BIOME_LABELS))
                    if invalid_codes:
                        raise ValueError(f"Unknown BIOME4 category codes: {invalid_codes}")
                    biome_encoded = np.where(biome_mask, BIOME_MISSING, biome_raw).astype("u1")
                    annual_blocks["biome"] = biome_encoded.tobytes(order="C")
                    codes, counts = np.unique(valid_biomes, return_counts=True)
                    biome_counts = {str(int(code)): int(count) for code, count in zip(codes, counts)}

                    npp_raw, npp_mask = masked_float(slabs["npp"])
                    lai_raw, lai_mask = masked_float(slabs["LAI"])
                    annual_blocks["annualNpp"] = encode_u16(npp_raw, npp_mask, ANNUAL_NPP_SCALE, "annual NPP")
                    annual_blocks["annualLai"] = encode_u16(lai_raw, lai_mask, LAI_SCALE, "annual LAI")
                    field_stats = {
                        "biome": {"codes": biome_counts, "missingCells": int(biome_mask.sum())},
                        "annualNpp": stats(npp_raw, npp_mask),
                        "annualLai": stats(lai_raw, lai_mask),
                    }
                else:
                    if "mo_npp" not in ds.variables:
                        raise ValueError(f"{label} BIOME4 file lacks mo_npp")
                    slab, lat, lon = standardize_slab(ds, "mo_npp", time_name, index)
                    validate_grid(lat, lon)
                    if grid_lat is not None and (not np.array_equal(grid_lat, lat) or not np.array_equal(grid_lon, lon)):
                        raise ValueError(f"{label} grid differs from annual BIOME4 grid")
                    raw, mask = masked_float(slab)
                    monthly_blocks.append(encode_i16(raw, mask, MONTHLY_NPP_SCALE, f"{label} monthly NPP"))
                    field_stats = {"monthlyNpp": stats(raw, mask)}

                records.append(source_record(label, guid, expected_hash, expected_size, coordinate, field_stats))
            path.unlink()

    raw_asset = b"".join([
        annual_blocks["biome"],
        annual_blocks["annualNpp"],
        annual_blocks["annualLai"],
        *monthly_blocks,
    ])
    expected_raw = CELLS + CELLS * 2 + CELLS * 2 + len(MONTHS) * CELLS * 2
    if len(raw_asset) != expected_raw:
        raise ValueError(f"Unexpected vegetation asset size {len(raw_asset)} != {expected_raw}")
    compressed = gzip.compress(raw_asset, compresslevel=9, mtime=0)
    ASSET_PATH.write_bytes(compressed)
    asset_sha = hashlib.sha256(compressed).hexdigest()

    biome_offset = 0
    annual_npp_offset = CELLS
    annual_lai_offset = annual_npp_offset + CELLS * 2
    monthly_npp_offset = annual_lai_offset + CELLS * 2
    meta = {
        "id": "krapp-2021-biome4-777ka",
        "yearsBeforePresent": TARGET_YEARS_BP,
        "rows": ROWS,
        "cols": COLS,
        "northLatitude": float(grid_lat[0]),
        "southLatitude": float(grid_lat[-1]),
        "westLongitude": float(grid_lon[0]),
        "eastLongitude": float(grid_lon[-1]),
        "spacingDegrees": 0.5,
        "months": list(MONTHS),
        "biomeLabels": {str(key): value for key, value in BIOME_LABELS.items()},
        "fields": {
            "biome": {"dtype": "uint8", "missingValue": BIOME_MISSING, "byteOffset": biome_offset, "byteLength": CELLS},
            "annualNpp": {"dtype": "uint16le", "scale": ANNUAL_NPP_SCALE, "missingValue": U16_MISSING, "byteOffset": annual_npp_offset, "byteLength": CELLS * 2, "sourceVariable": "npp"},
            "annualLai": {"dtype": "uint16le", "scale": LAI_SCALE, "missingValue": U16_MISSING, "byteOffset": annual_lai_offset, "byteLength": CELLS * 2, "sourceVariable": "LAI"},
            "monthlyNpp": {"dtype": "int16le", "scale": MONTHLY_NPP_SCALE, "missingValue": I16_MISSING, "byteOffset": monthly_npp_offset, "monthByteLength": CELLS * 2, "sourceVariable": "mo_npp"},
        },
        "asset": "data/krapp-777-vegetation.bin.gz",
        "assetCompression": "gzip",
        "assetSha256": asset_sha,
        "uncompressedBytes": len(raw_asset),
        "compressedBytes": len(compressed),
        "epistemicStatus": "study-constrained published BIOME4 model output at 777 ka; compact quantization is model-derived loss-limited preprocessing",
    }
    META_PATH.write_text(
        "// Generated by scripts/ingest-krapp-biome4-777.py. Do not edit by hand.\n"
        f"export const KRAPP_777_VEGETATION_META = Object.freeze({json.dumps(meta, indent=2)});\n"
    )
    manifest = {
        "schemaVersion": 1,
        "dataset": "Krapp et al. (2021) BIOME4 outputs",
        "paperDoi": "10.1038/s41597-021-01009-3",
        "archiveDoi": "10.17605/OSF.IO/8N43X",
        "targetYearsBeforePresent": TARGET_YEARS_BP,
        "sourceSelection": "original author BIOME4 annual output plus twelve monthly NPP outputs; exact -777000 coordinate",
        "records": records,
        "biomeLegend": {str(key): value for key, value in BIOME_LABELS.items()},
        "preprocessing": {
            "grid": "source 0.5 degree 360 x 720 grid reordered north-to-south and -180..180 longitude",
            "biome": "source integer category preserved as uint8; source fill mapped to 255",
            "annualNpp": f"source float32 quantized at {ANNUAL_NPP_SCALE} source NPP units per integer",
            "annualLai": f"source float32 quantized at {LAI_SCALE} LAI per integer",
            "monthlyNpp": f"source signed float32 quantized at {MONTHLY_NPP_SCALE} source NPP units per integer; negative values preserved",
        },
        "output": {
            "asset": str(ASSET_PATH.relative_to(ROOT)),
            "assetSha256": asset_sha,
            "compressedBytes": len(compressed),
            "uncompressedBytes": len(raw_asset),
        },
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {ASSET_PATH.relative_to(ROOT)}: {len(compressed):,} compressed bytes ({len(raw_asset):,} raw)")
    print(f"Asset SHA-256: {asset_sha}")
    print("Biome codes at 777 ka:", biome_counts)


if __name__ == "__main__":
    main()
