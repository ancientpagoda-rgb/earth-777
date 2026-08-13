# BIOME4 PFT driver transformed-data notice

`public/data/biome4-pft-drivers.bin.gz` is a transformed subset of `inputdata.nc` from the official BIOME4 4.1 PMIP distribution.

Earth 777 preserves the source `tmin` signed-int16 field exactly apart from deterministic 0.5° grid reordering. At runtime the value is divided by 10, matching BIOME4 4.1's operational use of the field as absolute-minimum temperature in degrees Celsius.

The upstream package and `inputdata.nc` SHA-256 values are pinned in `data/biome4-pft-drivers-manifest.json`. The transformed data retain the upstream GPL-2.0-only terms; the upstream license text is preserved in `data/licenses/BIOME4-GPL-2.0.txt`.

The Earth 777 JavaScript eligibility and snow routines are independently authored application code. They use factual model parameter values and documented operational semantics from the distributed BIOME4 4.1 model; no BIOME4 executable source is copied into those modules.
