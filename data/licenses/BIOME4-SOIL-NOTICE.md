# BIOME4 soil data notice

`public/data/biome4-soil.bin.gz` is a transformed subset of the `whc` and `perc` variables from `inputdata.nc` in the official BIOME4 4.1 package.

- Upstream package: `https://pmip2.lsce.ipsl.fr/share/synth/biome4/biome41.tar.gz`
- Package SHA-256: `c732b09ead940f10d7f10ac59629ad6e857437b965e10ae923327bc70c3c4a55`
- `inputdata.nc` SHA-256: `3c6189dddd264aacfe52842c61393a8fa288c3eec0c078d1d5a45d65041dfd15`
- Upstream package license: GNU GPL version 2, reproduced in `BIOME4-GPL-2.0.txt`.

The Earth 777 application code remains MIT-licensed. This transformed BIOME4 soil-data asset retains its upstream GPL-2.0-only terms. `scripts/ingest-biome4-soil.py` reproduces the transformed asset from the official package without incorporating BIOME4 program source code into the application.
