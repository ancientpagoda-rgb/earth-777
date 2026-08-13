#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

# Insert Hock 2003 immediately before La2004 without replacing any BIOME4 or
# other provenance entries added concurrently on main.
provenance_path = ROOT / "src/data/provenance.js"
provenance = provenance_path.read_text()
if 'id: "hock-2003"' not in provenance:
    marker = '  {\n    id: "la2004",'
    if marker not in provenance:
        raise SystemExit("Could not locate la2004 provenance insertion point")
    hock = '''  {
    id: "hock-2003",
    title: "Temperature index melt modelling in mountain areas",
    authors: "Regine Hock / Journal of Hydrology (2003)",
    url: "https://doi.org/10.1016/S0022-1694(03)00257-9",
    license: "published method review; no source data redistributed",
    role: "Literature basis for temperature-index snow/ice melt. Earth 777 uses a simple degree-day form with an explicitly provisional melt factor rather than claiming a calibrated 777 ka coefficient.",
    status: "integrated · model formulation reference"
  },
'''
    provenance = provenance.replace(marker, hock + marker, 1)
    provenance_path.write_text(provenance)

# Replace only the hydrology layer contract; preserve every concurrent
# vegetation/BIOME4 field and all other checkpoint metadata byte-for-byte.
checkpoint_path = ROOT / "src/data/checkpoint-777.js"
checkpoint = checkpoint_path.read_text()
pattern = r'    hydrology: Object\.freeze\(\{ status: "[^"]*", target: "[^"]*", sources: \[[^\]]*\] \}\),'
replacement = '    hydrology: Object.freeze({ status: "closed monthly soil+snow water budget, seasonal temperature-index melt, and upstream-accumulating ETOPO river network", target: "glacier mass balance, groundwater/baseflow, lakes, floodplains, and channel storage with sub-degree observed routing", sources: ["krapp-2021", "etopo-2022", "priestley-taylor-1972", "fao56", "hock-2003"] }),' 
checkpoint, count = re.subn(pattern, replacement, checkpoint, count=1)
if count != 1:
    raise SystemExit(f"Expected exactly one hydrology checkpoint contract, found {count}")
checkpoint_path.write_text(checkpoint)

print("Reconciled snowpack metadata without modifying BIOME4 metadata")
