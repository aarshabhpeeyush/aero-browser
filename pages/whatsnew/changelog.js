// Every version's highlights. Add the newest version at the TOP before building an update.
const CHANGELOG = [
  {
    version: "0.4.1",
    date: "October 2026",
    title: "Bug fixes",
    items: [
      { icon: "🪟", title: "Window buttons work again", text: "Minimise, maximise and close respond properly. Drag the window by the empty space in the tab bar." },
      { icon: "🖼️", title: "Tabs always show up", text: "Fixed pages staying blank until you opened Customize." },
      { icon: "1️⃣", title: "One browser at a time", text: "Opening Aero Browser again brings the open window to the front instead of starting a second copy." }
    ]
  },
  {
    version: "0.4.0",
    date: "October 2026",
    title: "Passwords, Power & website themes",
    items: [
      { icon: "🔑", title: "Password manager", text: "Log in to a site and Aero Browser offers to save your password. Next time, one click fills it in. The 🔑 button lets you see, copy, edit and add passwords, make strong new ones, and lock them with a PIN. Everything is encrypted and never leaves your computer." },
      { icon: "⚡", title: "Power: CPU & RAM manager", text: "Like Opera GX: live CPU and RAM graphs, how much each tab uses, a RAM limiter that puts unused tabs to sleep 💤, and a CPU limiter that slows down busy background tabs." },
      { icon: "🎨", title: "Themes that restyle websites", text: "Four new themes change websites too: 💧 Aqua Glass, 🌙 Dark Mode (makes every site dark), 🎮 Neon Gamer and 💾 Retro 2000, with extras for YouTube, Google, Roblox and Wikipedia. Make your own with websites.css and sites/<site>.css." },
      { icon: "🔐", title: "Google sign-in modes", text: "If Google blocks signing in, open Profiles and switch “Sign in as” between Chromium and Firefox." }
    ]
  },
  {
    version: "0.3.1",
    date: "October 2026",
    title: "Opening fix",
    items: [
      { icon: "🛠️", title: "Opens properly again", text: "Fixed a bug where a fresh install of 0.3.0 got stuck while setting up the example themes and never opened its window." },
      { icon: "🎨", title: "Themes repair themselves", text: "If any example theme files go missing, they're put back automatically." },
      { icon: "📋", title: "Error log", text: "If something goes wrong while starting, it's written to error.log in the browser's data folder so it can be fixed quickly." }
    ]
  },
  {
    version: "0.3.0",
    date: "October 2026",
    title: "Your browser, your style",
    items: [
      { icon: "🔄", title: "Automatic updates", text: "New versions download quietly in the background and install next time you close the browser, just like Chrome. When one is ready, a green “Restart to update” button appears." },
      { icon: "🎨", title: "Make your own themes", text: "Create themes with CSS files and the browser changes as soon as you save. Try the Bubble Pop and Luna XP examples in ✨ Customize → Custom themes." },
      { icon: "↔️", title: "Tabs on the side", text: "Put your tabs on the left or right, as well as top or bottom." },
      { icon: "🔐", title: "Better Google sign-in", text: "Signing in to Google from the Profiles button should work now." },
      { icon: "📰", title: "This page!", text: "After every update, What's new opens first so you can see what changed." }
    ]
  },
  {
    version: "0.2.0",
    date: "October 2026",
    title: "Profiles",
    items: [
      { icon: "👤", title: "Profiles & Google accounts", text: "Each profile keeps its own Google accounts, logins and tabs. Switch with your profile picture." },
      { icon: "➕", title: "Add shortcuts", text: "The + in the New Tab dock now works inside the browser." }
    ]
  },
  {
    version: "0.1.0",
    date: "October 2026",
    title: "Hello, Aero Browser!",
    items: [
      { icon: "🌐", title: "Your own browser", text: "Tabs, bookmarks, the Frost theme and the Aero New Tab with all its widgets." },
      { icon: "✨", title: "Customize", text: "Themes, colours, shine, tab shapes and layouts." }
    ]
  }
];
