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
    role: "Published 0.5° monthly temperature, precipitation, and cloud-cover reconstruction at the 777 ka checkpoint; all 36 source files are SHA-256 pinned in the climate manifest.",
    status: "integrated · 777 ka monthly 360 × 720 climate"
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
    id: "oudin-2005",
    title: "Towards a simple and efficient potential evapotranspiration model for rainfall–runoff modelling",
    authors: "Oudin et al. / Journal of Hydrology (2005)",
    url: "https://doi.org/10.1016/j.jhydrol.2004.08.026",
    license: "published method; citation required",
    role: "Temperature- and extraterrestrial-radiation-based potential evapotranspiration in the conservative water-balance layer; adapted to Earth 777's 360-day monthly climate calendar.",
    status: "integrated method · water-balance forcing"
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
