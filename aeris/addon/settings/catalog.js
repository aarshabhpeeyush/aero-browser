// What the Add-ons section offers. Originals ship inside Aeris; the rest come from addons.mozilla.org.
const ORIGINALS = [
  { id: "aero-beat-lab@aeris.app", file: "originals/aero-beat-lab.xpi", page: "app.html", icon: "originals/aero-beat-lab.png", name: "Beat Lab",
    description: "Your own music studio: make beats on a drum machine, mix songs on two DJ decks, find BPMs, record your mix and learn DJing." },
  { id: "aero-school-assist@aeris.app", file: "originals/aero-school-assist.xpi", page: "app.html", icon: "originals/aero-school-assist.png", name: "School Assist",
    description: "For 21K School: timetable, assignments as a to-do list, teacher messages, events, holidays and birthdays. Read-only." },
  { id: "desktop-gifs@rayytor", file: "originals/aero-desktop-gifs.xpi", icon: "originals/aero-desktop-gifs.png", name: "Desktop GIFs", author: "rayytor",
    description: "A GIF button in YouTube comments: search Tenor and attach a GIF.",
    warn: "⚠ YouTube is blocking GIF comments from computers right now, so posting usually fails. Search and the GIF button work." }
];

const RECOMMENDED = [
  { slug: "return-youtube-dislikes", category: "YouTube" },
  { slug: "sponsorblock", category: "YouTube" },
  { slug: "dearrow", category: "YouTube" },
  { slug: "youtube-recommended-videos", category: "Focus" },
  { slug: "youtube-nonstop", category: "YouTube" },
  { slug: "darkreader", category: "Look" },
  { slug: "colorzilla", category: "Tools" }
];
