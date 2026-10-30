// Every version's highlights. Add the newest version at the TOP before building an update.
const CHANGELOG = [
  {
    version: "0.5.1",
    date: "October 2026",
    title: "Into the woods",
    items: [
      { icon: "🍄", title: "Woodland Hut theme", text: "A cozy fantasy cabin in an enchanted forest: carved wood, mossy stones, parchment and a flickering lantern. It restyles the New Tab, every website, and YouTube, Google and Wikipedia too. Find it in ✨ Customize → Custom themes." },
      { icon: "➕", title: "Better New tab button", text: "With tabs on the left or right, the + is now a proper “+ New tab” button lined up under your tabs." },
      { icon: "⎋", title: "Esc leaves full screen", text: "Press Esc to exit a full screen video, or full screen mode (F11)." }
    ]
  },
  {
    version: "0.5.0",
    date: "October 2026",
    title: "Your friends asked, we built it",
    items: [
      { icon: "🪟", title: "A window for each profile", text: "Every profile now opens in its own window, like Chrome, and so does incognito. Open another profile from your profile picture, or press Ctrl+N for a new window." },
      { icon: "👤", title: "Your Gmail shows when signed in", text: "After signing in to Google, the Profiles panel now shows your account with your name, email and photo." },
      { icon: "🛡️", title: "Built-in ad blocker", text: "Blocks ads and trackers using the same lists as uBlock Origin. The shield in the address bar shows how many were blocked on each page." },
      { icon: "◫", title: "Split screen", text: "Click ◫ in the toolbar to see two tabs side by side. Right-click a link or tab to open it in split screen." },
      { icon: "🕶", title: "Incognito", text: "Browse without saving history, cookies, logins or passwords. The browser turns purple so you know. Press Ctrl+Shift+N, or open it from Profiles." },
      { icon: "💬", title: "Apps sidebar", text: "Discord, Spotify, WhatsApp and YouTube Music in a side panel, plus any website you add with +. Apps keep running while their panel is closed." },
      { icon: "📺", title: "Full screen videos", text: "Videos and games that go full screen now fill your whole screen." },
      { icon: "🖱️", title: "Right-click menus", text: "Right-click pages for link, picture and text options, and right-click tabs to duplicate, mute, sleep, split or close them." },
      { icon: "↩️", title: "Reopen closed tabs", text: "Closed a tab by mistake? Press Ctrl+Shift+T to bring it back." },
      { icon: "🤖", title: "Hide Google AI Overviews", text: "Google searches show plain results without the AI Overview box. You can switch this in Customize." },
      { icon: "🍃", title: "Battery saver", text: "When your laptop is unplugged (or always, if you like), background tabs slow down and animations stop to save battery. Find it in ⚡ Power." },
      { icon: "🧈", title: "Smoother tabs with limits on", text: "With RAM or CPU limits on, the tab you were just on stays awake, tabs go to sleep one at a time, and sleeping tabs start waking as soon as you point at them." },
      { icon: "📑", title: "Clean start", text: "New installs start with an empty bookmarks bar, ready for your own." },
      { icon: "↔️", title: "Side tabs fixed", text: "With tabs on the Left or Right, pages no longer stay blank." }
    ]
  },
  {
    version: "0.4.3",
    date: "October 2026",
    title: "Blank page fix",
    items: [
      { icon: "🖼️", title: "Stronger fix for blank pages", text: "When a tab is shown, the browser re-measures the page area and makes sure the page really gets drawn." },
      { icon: "👆", title: "Click to redraw", text: "If a page ever looks blank, click its tab again to redraw it." },
      { icon: "📋", title: "Debug log", text: "The browser notes what it does with the page area in debug.log, so any leftover blank-page problems can be found and fixed." }
    ]
  },
  {
    version: "0.4.2",
    date: "October 2026",
    title: "Tabs show up properly",
    items: [
      { icon: "🖼️", title: "Tabs load properly", text: "Tabs in the background now keep loading, just like in Chrome, and pages no longer stay blank until you open Customize." },
      { icon: "🔁", title: "Back from a game? Still drawn", text: "Switching back to Aero Browser from another app or game redraws the page straight away." },
      { icon: "🩹", title: "Crashed pages reload themselves", text: "If a page crashes, its tab loads it again instead of breaking." }
    ]
  },
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
