import { installEarthSystemHydrologyCoupling } from "./sim/EarthSystemHydrology.js";
import "./render/DemographyReadout.js";

installEarthSystemHydrologyCoupling();
await import("./main.js");
