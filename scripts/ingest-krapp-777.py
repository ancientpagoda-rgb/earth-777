#!/usr/bin/env python3
"""Extract the published Krapp et al. (2021) 777 ka monthly climate slice.

The source NetCDF files are downloaded one at a time from the authors' OSF
archive, verified against pinned SHA-256 hashes, sampled at the exact 777 ka
time coordinate, quantized into documented scientific units, and immediately
deleted. No multi-gigabyte source archive is retained.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import struct
import tempfile
import urllib.request

try:
    import netCDF4 as nc
    import numpy as np
except ImportError as exc:
    raise SystemExit(
        "Krapp ingestion requires Python packages netCDF4 and numpy. "
        "Install them with: python3 -m pip install netCDF4 numpy"
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
ASSET_PATH = ROOT / "public/data/krapp-777-climate.bin.gz"
META_PATH = ROOT / "src/data/generated/krapp-777-meta.generated.js"
MANIFEST_PATH = ROOT / "data/climate-manifest.json"
TARGET_YEARS_BP = 777_000
MISSING = 65_535
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

# Final, bias-corrected/remapped 0.5-degree products from the original author
# archive: https://osf.io/8n43x/ (DOI 10.17605/OSF.IO/8N43X).
SOURCES = {
    "temperature": {
        "variable_hint": "temp",
        "files": {
            "jan": ("mbxsr", "37561a2d9ea343f5f05b55c2a6da0b8693c4310d17de6519af78b452761706d0", 149392603),
            "feb": ("edg3m", "6b43326f0b451bb8ae56a6461a610053fe5132ff4baf0e5df02a5b048fcd71bd", 149110176),
            "mar": ("267k8", "5eae4dae0b7e9e2b8ce69e88bae3b0edca1ec7d0db830c1bf1fccd728127380e", 148281585),
            "apr": ("8kz53", "42d4d325a84ea012edf7b36e4ea4e57d60dc95e52c81596168e5a80ae41516ef", 147032146),
            "may": ("sm39c", "52b19cac6037f89a49f79e1fd50ad40dd54d308aa2e685607173df8ab7b3b91c", 146005396),
            "jun": ("47tsb", "1a168d1bf49d2139b9410787bc31c6ffe700a05567c436e1725e63426fae3f71", 145968396),
            "jul": ("h62tq", "60a8a2c55135e693d8087912cf7a9e78be77c0852b2e065123be2a74a01bb785", 145734066),
            "aug": ("hevjd", "3544c045bc7dbfb077f08c9b399e32f93d3e97d7e5eab018221cc9488c00a580", 145207434),
            "sep": ("6xtqr", "cc026a84e5f3fd0babd750f5b2c632886ac6d0e1859bae7987e4df5523c5ebf3", 145395306),
            "oct": ("wfsv5", "3ece259547172d6aaa3b0c661a4f6b4b64caea1566a4f4cef0980a51245db710", 147303618),
            "nov": ("nvdsk", "604745d8fbbc5edbfaa41058526949061b93357c0a02171f9c9d255d1b9d25d0", 149254496),
            "dec": ("8zbqj", "b8cdd22f8a954113836710eb72f3f78644d129efb121061adf5be37ebde542ad", 149505260),
        },
    },
    "precipitation": {
        "variable_hint": "prec",
        "files": {
            "jan": ("6khc8", "67cf88b21c5e6009ecab0bbd83f77e337c5a2a042c6fb7bbe8290044b55a1ed3", 170729674),
            "feb": ("5s6tp", "fdb28ea155bde3643f7308595a767acb256faebe780e9b20a795288b624fa876", 170027313),
            "mar": ("8yhz9", "22b0abf6819c442d2bc9af61fedf93fb2e503ce137ee5769d1dfd18a29a9a265", 171090765),
            "apr": ("6mq2r", "b6450572fa3d88ed4f98dc836ed13551e0a4f29bbc15c90e75082724f60d0d02", 170747248),
            "may": ("dn8pe", "4e15d9bebb9c48ee12c995befff14dd4bae3eb3f19ef9223c343c64fcf291a6b", 174419384),
            "jun": ("pzywf", "2f069099f2ea5171e71543124e67d405d646440a79a27af63cc82541b74067d1", 181229336),
            "jul": ("wxzhe", "6b0d91765050c419104891d8a9de029300515b276fbfd5c6078a805b3657f570", 185846054),
            "aug": ("c84ve", "4357127640ebea99c5701d1420b149bddf750d4f316e5fc617847adbf96df5a9", 187486854),
            "sep": ("p84xn", "a14743586421273b380b1ddea577e777ad557a028d50568a2b67671bd823bc9b", 187731972),
            "oct": ("utfsa", "45fb4fd2f8014bd42ae0025f7f5dc5633a0849bb975f8558a1fda3ac32226169", 182019485),
            "nov": ("wavsd", "046979b8528d25440d006dd7701ce41efb4d8105880bb27c48e7b10d499884e5", 169876345),
            "dec": ("h5eq7", "1547e8742f2a56f4e447ccb585253bfd0dcfae64ed5b0e25b43e87b162ea0ee6", 170274112),
        },
    },
    "cloudCover": {
        "variable_hint": "tcc",
        "files": {
            "jan": ("4j5rq", "33b0530c05deaff14ea47a74d3801cf2045cd296a6337f4871d6694185828819", 180418816),
            "feb": ("42rhc", "b220eb92fcf2954cf795bb4c4e1b73879c35cfc87e4ff5ed2b34aede6c40268c", 179855313),
            "mar": ("2wgxm", "546f0e4bd95f23b973f40d2bbb38447d6960f5d95e82dc18ffc8e832815dc10f", 178105874),
            "apr": ("d5z3u", "a65ee5a9290a1e22c59733fb384370912dc1d62d37f18b07ce4177e11d4daab8", 176511667),
            "may": ("yrac7", "8056201a9397a3dc24e0183db36cc9ba40c98a0167628f17a60e986d5716911f", 176990178),
            "jun": ("4m8ug", "fcaca7724315e14f8f40ded1e0155851802ba190925c90ee182c7d0f3ea22e67", 177894154),
            "jul": ("qu2vh", "7016bc293acd485f8c3a64f622f255130eaee368f65dd98397aa8a9c49247a69", 178032410),
            "aug": ("3mdvz", "bcc29e808c65b8f61f85f8d3377b7fb9b8db0ad43b60ccd2941e34f826d10764", 177525537),
            "sep": ("rg6ac", "9784e4e10fa258630381c57760629f7d0262cd5d5b056d8534f0045a92ccbcd9", 175772113),
            "oct": ("893xt", "c4ebd9aad9fc409d924124ed04c8b507bcbe7b702024a5e08a3a2ddc041805bd", 175950228),
            "nov": ("tkqas", "afeb7984bb255e7b4270be5e9a041a337826bc1cb1784f5964a1e01522797481", 178367042),
            "dec": ("fsjqg", "84ba2766c6c370b3144dafd6d00ca5f201dda209c64e15e3f94a655217837502", 180414570),
        },
    },
}

QUANTIZATION = {
    "temperature": {"scale": 0.01, "offset": 0.0, "units": "K", "description": "uint16 centi-kelvin"},
    "precipitation": {"scale": 1.0, "offset": 0.0, "units": "source mm/a", "description": "uint16 integer source precipitation units"},
    "cloudCover": {"scale": 0.01, "offset": 0.0, "units": "%", "description": "uint16 centi-percent"},
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, path: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "earth-777-krapp-ingest/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response, path.open("wb") as output:
        shutil.copyfileobj(response, output, length=8 * 1024 * 1024)


def coordinate_name(ds: nc.Dataset, axis: str) -> str:
    aliases = {
        "time": {"time"},
        "lat": {"lat", "latitude"},
        "lon": {"lon", "longitude"},
    }[axis]
    for name, variable in ds.variables.items():
        if name.lower() in aliases:
            return name
        standard = str(getattr(variable, "standard_name", "")).lower()
        if standard in aliases:
            return name
    raise ValueError(f"Could not identify {axis} coordinate")


def time_index(values: np.ndarray) -> tuple[int, float]:
    values = np.asarray(values, dtype=float)
    candidates = (-TARGET_YEARS_BP, TARGET_YEARS_BP, -TARGET_YEARS_BP / 1000, TARGET_YEARS_BP / 1000)
    for target in candidates:
        hits = np.where(np.isclose(values, target, rtol=0, atol=1e-6))[0]
        if hits.size:
            return int(hits[0]), float(values[hits[0]])
    nearest = int(np.argmin(np.min(np.abs(values[:, None] - np.asarray(candidates)[None, :]), axis=1)))
    raise ValueError(
        f"No exact 777 ka time coordinate. Range {values.min()}..{values.max()}, nearest {values[nearest]}"
    )


def data_variable(ds: nc.Dataset, hint: str, time_name: str, lat_name: str, lon_name: str) -> str:
    preferred = [hint, hint.lower(), {"temp": "temperature", "prec": "precipitation", "tcc": "cloudcover"}.get(hint, hint)]
    for name in preferred:
        if name in ds.variables:
            dims = ds.variables[name].dimensions
            if time_name in dims and lat_name in dims and lon_name in dims:
                return name
    candidates = []
    for name, variable in ds.variables.items():
        dims = variable.dimensions
        if time_name in dims and lat_name in dims and lon_name in dims and len(dims) == 3:
            candidates.append(name)
    if len(candidates) != 1:
        raise ValueError(f"Ambiguous climate data variables: {candidates}")
    return candidates[0]


def standardize_grid(ds: nc.Dataset, variable_name: str, index: int, lat_name: str, lon_name: str) -> tuple[np.ma.MaskedArray, np.ndarray, np.ndarray]:
    variable = ds.variables[variable_name]
    dims = list(variable.dimensions)
    selectors = [slice(None)] * len(dims)
    selectors[dims.index(coordinate_name(ds, "time"))] = index
    slab = np.ma.asarray(variable[tuple(selectors)])

    remaining_dims = [d for d in dims if d != coordinate_name(ds, "time")]
    lat_axis = remaining_dims.index(lat_name)
    lon_axis = remaining_dims.index(lon_name)
    if (lat_axis, lon_axis) != (0, 1):
        slab = np.ma.transpose(slab, (lat_axis, lon_axis))

    lat = np.asarray(ds.variables[lat_name][:], dtype=float)
    lon = np.asarray(ds.variables[lon_name][:], dtype=float)
    lat_order = np.argsort(lat)[::-1]
    normalized_lon = ((lon + 180.0) % 360.0) - 180.0
    lon_order = np.argsort(normalized_lon)
    slab = slab[lat_order][:, lon_order]
    return slab, lat[lat_order], normalized_lon[lon_order]


def quantize(variable: str, slab: np.ma.MaskedArray) -> tuple[bytes, dict]:
    values = np.ma.asarray(slab, dtype=float)
    source = np.asarray(np.ma.filled(values, np.nan), dtype=float)
    # The final CDO-produced temperature/cloud files contain the CDO default
    # missing sentinel (~9.96921e36) even though missing_value is NaN. Treat
    # extreme sentinels as missing rather than scientific values.
    mask = np.ma.getmaskarray(values) | ~np.isfinite(source) | (np.abs(source) > 1e20)
    filled = np.where(mask, 0.0, source)
    rule = QUANTIZATION[variable]

    if variable == "temperature":
        finite = filled[~mask]
        if finite.size and (finite.min() < 150 or finite.max() > 380):
            raise ValueError(f"Unexpected temperature units/range: {finite.min()}..{finite.max()}")
    elif variable == "precipitation":
        filled = np.maximum(0, filled)
    elif variable == "cloudCover":
        finite = filled[~mask]
        if finite.size and finite.max() <= 1.01:
            raise ValueError("Cloud cover appears fractional; source product was expected in percent")
        filled = np.clip(filled, 0, 100)

    encoded = np.rint((filled - rule["offset"]) / rule["scale"])
    if np.any(encoded[~mask] < 0) or np.any(encoded[~mask] >= MISSING):
        finite = encoded[~mask]
        raise ValueError(f"Quantized {variable} exceeds uint16 range: {finite.min()}..{finite.max()}")
    encoded = encoded.astype("<u2")
    encoded[mask] = MISSING

    finite_source = source[~mask]
    stats = {
        "finiteCells": int(finite_source.size),
        "missingCells": int(mask.sum()),
        "minimum": float(finite_source.min()) if finite_source.size else None,
        "maximum": float(finite_source.max()) if finite_source.size else None,
        "mean": float(finite_source.mean()) if finite_source.size else None,
    }
    return encoded.tobytes(order="C"), stats


def main() -> None:
    payload = bytearray()
    records = []
    common_grid = None
    common_units = {}
    with tempfile.TemporaryDirectory(prefix="earth777-krapp-") as temporary:
        tmp = Path(temporary)
        for variable, spec in SOURCES.items():
            for month_index, month in enumerate(MONTHS):
                file_id, expected_sha, expected_size = spec["files"][month]
                url = f"https://osf.io/download/{file_id}/"
                source_path = tmp / f"{variable}-{month}.nc"
                print(f"Downloading {variable} {month}: {url}", flush=True)
                download(url, source_path)
                actual_size = source_path.stat().st_size
                if actual_size != expected_size:
                    raise ValueError(f"Size mismatch for {variable} {month}: {actual_size} != {expected_size}")
                actual_sha = sha256_file(source_path)
                if actual_sha != expected_sha:
                    raise ValueError(f"SHA-256 mismatch for {variable} {month}: {actual_sha} != {expected_sha}")

                with nc.Dataset(source_path) as ds:
                    time_name = coordinate_name(ds, "time")
                    lat_name = coordinate_name(ds, "lat")
                    lon_name = coordinate_name(ds, "lon")
                    index, matched_time = time_index(ds.variables[time_name][:])
                    data_name = data_variable(ds, spec["variable_hint"], time_name, lat_name, lon_name)
                    source_units = str(getattr(ds.variables[data_name], "units", ""))
                    slab, lat, lon = standardize_grid(ds, data_name, index, lat_name, lon_name)
                    if slab.shape != (360, 720):
                        raise ValueError(f"Unexpected final Krapp grid for {variable} {month}: {slab.shape}")
                    if common_grid is None:
                        common_grid = (lat.copy(), lon.copy())
                    else:
                        if not np.allclose(lat, common_grid[0]) or not np.allclose(lon, common_grid[1]):
                            raise ValueError(f"Coordinate grid changed in {variable} {month}")
                    if variable not in common_units:
                        common_units[variable] = source_units
                    elif common_units[variable] != source_units:
                        raise ValueError(f"Units changed for {variable}: {common_units[variable]} vs {source_units}")
                    encoded, stats = quantize(variable, slab)
                    byte_offset = len(payload)
                    payload.extend(encoded)
                    records.append({
                        "variable": variable,
                        "month": month,
                        "monthIndex": month_index,
                        "sourcePath": f"data/{'total_cloud_cover' if variable == 'cloudCover' else variable}/"
                                      f"{'tcc' if variable == 'cloudCover' else 'prec' if variable == 'precipitation' else 'temp'}_800ka_{month}.nc",
                        "osfFileId": file_id,
                        "downloadUrl": url,
                        "sha256": expected_sha,
                        "bytes": expected_size,
                        "sourceVariable": data_name,
                        "sourceUnitsMetadata": source_units or None,
                        "encodedUnits": QUANTIZATION[variable]["units"],
                        "timeCoordinate": matched_time,
                        "byteOffset": byte_offset,
                        "byteLength": len(encoded),
                        "stats": stats,
                    })
                source_path.unlink()

    lat, lon = common_grid
    if not np.allclose(np.diff(lat), -0.5) or not np.allclose(np.diff(lon), 0.5):
        raise ValueError("Krapp final grid is not the expected regular half-degree grid")

    ASSET_PATH.parent.mkdir(parents=True, exist_ok=True)
    compressed = gzip.compress(bytes(payload), compresslevel=9, mtime=0)
    ASSET_PATH.write_bytes(compressed)
    asset_sha = hashlib.sha256(compressed).hexdigest()

    meta = {
        "id": "krapp-2021-777ka-monthly-climate",
        "yearsBeforePresent": TARGET_YEARS_BP,
        "rows": 360,
        "cols": 720,
        "northLatitude": float(lat[0]),
        "southLatitude": float(lat[-1]),
        "westLongitude": float(lon[0]),
        "eastLongitude": float(lon[-1]),
        "spacingDegrees": 0.5,
        "months": MONTHS,
        "variables": {
            variable: {
                **QUANTIZATION[variable],
                "sourceUnits": common_units[variable],
                "blockByteOffset": next(r["byteOffset"] for r in records if r["variable"] == variable and r["month"] == "jan"),
                "monthByteLength": 360 * 720 * 2,
            }
            for variable in SOURCES
        },
        "missingValue": MISSING,
        "asset": "data/krapp-777-climate.bin.gz",
        "assetCompression": "gzip",
        "assetSha256": asset_sha,
        "uncompressedBytes": len(payload),
        "compressedBytes": len(compressed),
        "epistemicStatus": "study constrained published reconstruction at 777 ka; quantization is model-derived loss-limited preprocessing",
    }
    META_PATH.parent.mkdir(parents=True, exist_ok=True)
    META_PATH.write_text(
        "// Generated by scripts/ingest-krapp-777.py. Do not edit by hand.\n"
        f"export const KRAPP_777_META = Object.freeze({json.dumps(meta, indent=2)});\n",
        encoding="utf-8",
    )

    manifest = {
        "schemaVersion": 1,
        "generatedBy": "scripts/ingest-krapp-777.py",
        "source": {
            "title": "High-resolution global terrestrial climate for the last 800,000 years",
            "authors": "Krapp et al. (2021)",
            "paperDoi": "10.1038/s41597-021-01009-3",
            "dataDoi": "10.17605/OSF.IO/8N43X",
            "archive": "original authors' OSF project",
            "selection": "exact 777 ka time slice from each published final 0.5-degree monthly NetCDF",
        },
        "target": {
            "yearsBeforePresent": TARGET_YEARS_BP,
            "grid": {"rows": 360, "cols": 720, "spacingDegrees": 0.5},
            "months": MONTHS,
            "variables": list(SOURCES.keys()),
        },
        "encoding": {
            "layout": "variable-major, month-major, north-to-south then west-to-east row-major uint16 little-endian",
            "missingValue": MISSING,
            "quantization": QUANTIZATION,
            "outerCompression": "deterministic gzip level 9, mtime 0",
        },
        "records": records,
        "output": {
            "asset": str(ASSET_PATH.relative_to(ROOT)),
            "assetSha256": asset_sha,
            "compressedBytes": len(compressed),
            "uncompressedBytes": len(payload),
            "metadataModule": str(META_PATH.relative_to(ROOT)),
        },
        "interpretation": {
            "classification": "study constrained published reconstruction; model-derived quantization",
            "caveat": "These are the authors' reconstructed climate fields, not direct observations. Earth 777 uses the 777 ka fields as the spatial checkpoint baseline; later Free Earth divergence must be explicitly modeled rather than relabeling these data as future states.",
        },
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {ASSET_PATH.relative_to(ROOT)}: {len(compressed):,} compressed bytes ({len(payload):,} raw)")
    print(f"Asset SHA-256: {asset_sha}")


if __name__ == "__main__":
    main()
