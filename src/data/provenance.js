export const SOURCES = Object.freeze([
  {
    id: "ruddiman-2018-mis19",
    title: "Glacial Inception in Marine Isotope Stage 19",
    authors: "Vavrus et al. / Scientific Reports (2018)",
    url: "https://doi.org/10.1038/s41598-018-28419-5",
    license: "CC BY 4.0",
    role: "Direct 777 ka orbital and greenhouse-gas boundary conditions; CCSM4 climate comparison.",
    status: "integrated"
  },
  {
    id: "krapp-2021",
    title: "High-resolution global terrestrial climate for the last 800,000 years",
    authors: "Krapp et al. / Scientific Data (2021)",
    url: "https://doi.org/10.1038/s41597-021-01009-3",
    license: "CC BY 4.0",
    role: "Published 0.5° monthly climate plus BIOME4 biome, annual NPP/LAI, and signed monthly NPP at the 777 ka checkpoint; original author inputs are SHA-256 pinned in reproducible manifests.",
    status: "integrated · 777 ka climate + BIOME4 vegetation"
  },
  {
    id: "biome4-4.1-soil",
    title: "BIOME4 4.1 comprehensive driver dataset — static soil fields",
    authors: "BIOME4 4.1 / PMIP distribution",
    url: "https://pmip2.lsce.ipsl.fr/share/synth/biome4/biome41.tar.gz",
    license: "GPL-2.0-only for the transformed soil-data asset; upstream COPYING retained in data/licenses",
    role: "Static 0.5° two-layer water-holding-capacity and percolation inputs plus factual BIOME4 4.1 PFT parameter/constraint semantics. Earth 777 preserves the source soil floats and implements the climate-eligibility sieve independently rather than copying BIOME4 program structure.",
    status: "integrated · 0.5° soil driver + PFT climate-eligibility parameter reference"
  },
  {
    id: "priestley-taylor-1972",
    title: "On the Assessment of Surface Heat Flux and Evaporation Using Large-Scale Parameters",
    authors: "Priestley & Taylor / Monthly Weather Review (1972)",
    url: "https://doi.org/10.1175/1520-0493(1972)100%3C0081:OTAOSH%3E2.3.CO;2",
    license: "published formulation reference; no source data redistributed",
    role: "Equilibrium energy-balance formulation used for model-derived potential evapotranspiration where the paleoclimate checkpoint lacks wind and humidity fields.",
    status: "integrated · model formulation"
  },
  {
    id: "fao56",
    title: "Crop evapotranspiration — Guidelines for computing crop water requirements",
    authors: "Allen, Pereira, Raes & Smith / FAO Irrigation and Drainage Paper 56 (1998)",
    url: "https://www.fao.org/4/x0490e/x0490e00.htm",
    license: "FAO publication reference; no source data redistributed",
    role: "Solar geometry, extraterrestrial-radiation equations, reference-surface albedo, and default Angstrom coefficients used in the hydrology radiation estimate.",
    status: "integrated · model formulation"
  },
  {
    id: "la2004",
    title: "La2004 astronomical solution",
    authors: "Laskar et al. / Astronomy & Astrophysics (2004)",
    url: "https://doi.org/10.1051/0004-6361:20041335",
    license: "research data; verify redistribution terms",
    role: "Time-varying eccentricity, obliquity, and longitude of perihelion at 1 kyr resolution; anomalies are anchored to the published CCSM4 checkpoint.",
    status: "integrated · 778 rows"
  },
  {
    id: "spratt-lisiecki-2016",
    title: "Global sea-level reconstruction, 0–800 ka",
    authors: "Spratt & Lisiecki (2016) / NOAA WDS Paleoclimatology",
    url: "https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=noaa-ocean-19982",
    license: "NOAA public data; attribution required",
    role: "Five-record sea-level reconstruction, 1σ uncertainty, and 95% interval through the forward run.",
    status: "integrated · 778 rows"
  },
  {
    id: "etopo-2022",
    title: "ETOPO 2022 Global Relief Model",
    authors: "NOAA National Centers for Environmental Information",
    url: "https://doi.org/10.25921/fd45-gt74",
    license: "unrestricted global coverage; attribution required",
    role: "Modern bedrock relief and bathymetry baseline. A checksum-pinned half-degree browser layer drives land/ocean classification and ocean depth; simulated paleo sea level is applied separately.",
    status: "integrated · 360 × 720 compact bedrock grid"
  },
  {
    id: "lr04",
    title: "LR04 benthic δ18O stack",
    authors: "Lisiecki & Raymo / Paleoceanography (2005)",
    url: "https://doi.org/10.1029/2004PA001071",
    license: "published research data",
    role: "Independent global ice-volume and deep-ocean-temperature constraint.",
    status: "validation"
  },
  {
    id: "neotoma",
    title: "Neotoma Paleoecology Database",
    authors: "International community-curated fossil data",
    url: "https://api.neotomadb.org/",
    license: "dataset-specific; API and code open",
    role: "Fossil and paleoecological range evidence with spatial, temporal, and publication metadata.",
    status: "adapter prepared"
  },
  {
    id: "road",
    title: "ROCEEH Out of Africa Database",
    authors: "Heidelberg Academy / Senckenberg / University of Tübingen",
    url: "https://dataportal.senckenberg.de/dataset/road-roceeh-out-of-africa-database",
    license: "CC BY 4.0",
    role: "Archaeological, hominin, faunal, botanical, and geographic constraints from 3 Ma to 20 ka.",
    status: "adapter prepared"
  },
  {
    id: "madingley",
    title: "Madingley General Ecosystem Model",
    authors: "Harfoot et al. / PLOS Biology (2014)",
    url: "https://doi.org/10.1371/journal.pbio.1001841",
    license: "open source; component terms require review",
    role: "Reference equations and aggregation strategy for mechanistic ecosystem dynamics.",
    status: "reference"
  },
  {
    id: "mb-reversal",
    title: "Matuyama–Brunhes reversal at the Chiba composite section",
    authors: "Haneda et al. / Progress in Earth and Planetary Science (2020)",
    url: "https://doi.org/10.1186/s40645-020-00354-y",
    license: "CC BY 4.0",
    role: "Timing and structure of the geomagnetic transition following the checkpoint.",
    status: "integrated"
  }
]);

export function sourceById(id) {
  return SOURCES.find((source) => source.id === id);
}
