// Educational content for the Director dossiers: what each target place is, why crews are going,
// what it is like there, how Oman helps rehearse it, and what Earth cannot copy.
// Facts are from NASA mission material (Artemis, LRO, LCROSS, Perseverance, Curiosity, Opportunity, Oman Drilling Project).

export const WORLD_FACTS = {
  moon: [
    { k: "Gravity", v: "1/6 of Earth", d: "1.62 m/s². An astronaut and suit of about 150 kg weigh what 25 kg does on Earth." },
    { k: "Air", v: "None", d: "A vacuum: no breathing, no sound, no shield from radiation or tiny meteorites." },
    { k: "Cold", v: "below −230 °C", d: "In craters at the pole that never see the Sun, among the coldest places measured in the solar system." },
    { k: "Day", v: "29.5 Earth days", d: "At the pole the Sun never climbs high; it circles low along the horizon, casting very long shadows." },
    { k: "Trip", v: "about 3 days", d: "384,400 km from Earth. Radio takes 1.3 seconds each way, so crews can talk with Earth almost live." },
  ],
  mars: [
    { k: "Gravity", v: "38% of Earth", d: "3.71 m/s². Everything weighs about a third of what it does on Earth, so walking is bouncy." },
    { k: "Air", v: "under 1% of Earth's", d: "Thin carbon dioxide. Enough for wind and dust storms, too thin to breathe or to stop radiation." },
    { k: "Cold", v: "about −55 °C average", d: "At Jezero (Perseverance weather station). The air swings 50–60 °C between day and night." },
    { k: "Day", v: "24 h 39 min", d: "A Mars day, called a sol, is only a little longer than ours." },
    { k: "Trip", v: "about 7 months", d: "Radio takes 4 to 24 minutes each way, so the crew and robots must act on their own." },
  ],
};

export const LEARN = {
  moon_base: {
    place: "Shackleton crater sits almost exactly on the Moon's south pole. It is about 21 km wide and more than 4 km deep.",
    why: [
      "Sunlight here only skims the horizon. The floors of deep craters never see the Sun, and water ice has stayed frozen in them for billions of years (NASA's LCROSS probe confirmed water near the pole in 2009).",
      "Ice can become drinking water, oxygen to breathe, and hydrogen and oxygen for rocket fuel, so a base can make what it needs instead of shipping it from Earth.",
      "Nearby ridges are lit for most of the year, so solar panels can work almost without a break. NASA's Artemis missions aim to land astronauts in this region.",
    ],
    oman: "Oman cannot copy the cold or the vacuum, but its bare, rocky, plant-free ground lets crews rehearse what happens on the surface: driving rovers over rough ground, walking in suits, choosing where a habitat, solar panels and antennas can stand, and keeping dust out of equipment. Hills that throw long shadows and block radio links, as ridges do at the pole, change how a base must be laid out.",
    cant: ["Low gravity", "Vacuum", "Deep cold", "Space radiation"],
    did: "Apollo astronauts found Moon dust sharp and clingy: it scratched visors and jammed seals. Keeping dust under control is one of the first problems a base must solve.",
    learn: "Look for: grazing light, long shadows, and the dark crater floors where ice hides.",
  },
  mars_landing: {
    place: "The flat floor of Jezero crater, where NASA's Perseverance rover touched down on 18 February 2021.",
    why: [
      "Landing is the most dangerous few minutes of any Mars mission. Radio signals take minutes to arrive, so no one on Earth can steer: the spacecraft has to land itself.",
      "Perseverance used Terrain-Relative Navigation: it photographed the ground during descent, matched the pictures with a map stored on board, and steered away from cliffs and boulder fields to a safe spot.",
      "Future crews will need landing pads that are flat, firm and free of rocks, and a camp far enough away that rocket exhaust does not blast it.",
    ],
    oman: "Oman's gravel plains have slopes and scattered rocks like the crater floor. That lets teams rehearse the full chain: map hazards from above (our drone LiDAR), pick a safe pad, land, and plan rover routes from the pad to the work sites.",
    cant: ["Thin air for parachutes", "Low gravity", "Signal delay"],
    did: "Perseverance's landing was nicknamed \"seven minutes of terror\": from the top of the atmosphere to the ground, everything happened on autopilot.",
    learn: "Look for: wide, gentle ground with few boulders, which is exactly what a landing team hopes for.",
  },
  mars_science: {
    place: "Jezero crater is about 45 km wide. Around 3.5 billion years ago it held a lake, fed by a river that built a fan-shaped delta on its western edge.",
    why: [
      "River deltas trap fine mud, and mud is good at preserving traces of life. If Mars ever had microbes, a delta is one of the best places to look.",
      "Perseverance is drilling rock cores here and sealing them in tubes so that a future mission could bring them back to laboratories on Earth.",
      "On the crater floor it found olivine-rich rock that water had changed into carbonate minerals: a sign that rock and water reacted here long ago.",
    ],
    oman: "Oman's mountains hold the same kind of rock, olivine-rich mantle rock from deep inside the Earth, and in Oman it is turning into serpentine and carbonate right now as rainwater and air react with it. The reaction also releases hydrogen, a food some microbes live on. Scientists drilled these rocks in the Oman Drilling Project (2016–2018), so Oman shows, live, a process that Jezero preserves frozen in time.",
    cant: ["Low gravity", "Thin, cold air", "Space radiation"],
    did: "Jezero means \"lake\" in several Slavic languages. The crater is named after a town in Bosnia and Herzegovina.",
    learn: "Look for: water-formed minerals. Our score gives them the most weight for this mission.",
  },
  mars_sedimentary: {
    place: "Gale crater holds Mount Sharp, a stack of rock layers about 5 km high. Meridiani Planum is a wide plain of layered sandstone.",
    why: [
      "Each rock layer records the water and climate at the time it formed, like pages in a book read from the bottom up.",
      "NASA's Curiosity rover (landed at Gale in August 2012) found mudstone from an ancient lake that could once have supported microbes.",
      "Opportunity (landed at Meridiani in January 2004) found small spheres of the mineral hematite, nicknamed \"blueberries\", that formed in groundwater.",
    ],
    oman: "Oman has layered sedimentary rock cut open by dry wadis, so geologists can rehearse what a Mars crew must do: read the layers, work out which ones formed in water, and decide which few samples are worth carrying home.",
    cant: ["Low gravity", "Thin, cold air", "Space radiation"],
    did: "Opportunity was designed to last 90 days. It kept driving for almost 15 years and covered more than 45 km.",
    learn: "Look for: layered rock exposed in valley walls, the Earth version of Mount Sharp's pages.",
  },
};
