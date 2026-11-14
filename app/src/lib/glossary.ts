/** Plain-English explanations for scientific terms shown in tooltips. */
export const GLOSSARY = {
  elevation: {
    term: "Elevation",
    text: "Height of the ground in metres. On Mars it is measured relative to the areoid (Mars' 'sea level'), so values in Jezero are negative, around −2,570 m.",
  },
  areoid: {
    term: "Areoid",
    text: "Mars' reference 'sea level': a surface of equal gravity used as zero elevation. Mars has no oceans, so this is a mathematical surface.",
  },
  slope: {
    term: "Slope",
    text: "How steep the ground is, in degrees (0° = flat). Computed in Python from the elevation model using Horn's 3×3 method.",
  },
  hazard: {
    term: "Hazard class",
    text: "Our planning categories for walking: under 10° easy, 10–15° moderate, 15–25° hazard, 25° and above no-go. These thresholds are PAWPRINT assumptions, not NASA rules.",
  },
  sol: {
    term: "Sol",
    text: "One Mars day (about 24 h 39 min). Sol 0 is the day Perseverance landed, 18 Feb 2021.",
  },
  dtm: {
    term: "DTM",
    text: "Digital Terrain Model: a grid where every cell stores the ground height. Ours come from USGS, built from orbital stereo images.",
  },
  ctx: {
    term: "CTX",
    text: "Context Camera on NASA's Mars Reconnaissance Orbiter. Its terrain model has one height every 20 m.",
  },
  hirise: {
    term: "HiRISE",
    text: "NASA's sharpest Mars orbital camera. Its terrain model has one height every 1 m. We use a 3 × 2.7 km window around the landing site.",
  },
  meda: {
    term: "MEDA",
    text: "Mars Environmental Dynamics Analyzer: Perseverance's weather station. NASA's public feed stopped updating at sol 1133 (April 2024).",
  },
  ls: {
    term: "Ls (solar longitude)",
    text: "Mars' position around the Sun, used to describe the season. 0° is the start of northern spring.",
  },
  lmst: {
    term: "LMST",
    text: "Local Mean Solar Time at the rover: Mars clock time, where noon is when the Sun is roughly highest.",
  },
  astar: {
    term: "A* search",
    text: "A path-finding algorithm. Ours searches the terrain grid for the route with the lowest estimated walking time, avoiding cells steeper than your slope limit.",
  },
  walktime: {
    term: "Estimated walk time",
    text: "Uses Tobler's hiking function, which was fitted to Earth hikers, plus a penalty on steep ground. It ranks routes; it is not a validated Mars EVA time.",
  },
  difficulty: {
    term: "Difficulty score",
    text: "A 0–100 PAWPRINT estimate combining distance, climb, maximum slope and steep terrain. Useful for comparing routes only.",
  },
  derived: {
    term: "Derived",
    text: "Calculated by our Python code from real NASA/USGS data, for example slope from elevation.",
  },
  estimated: {
    term: "Estimated position",
    text: "NASA's sample table lists names and dates, not coordinates. We place each sample at the rover's last NASA position on or before the day the sample was sealed.",
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
