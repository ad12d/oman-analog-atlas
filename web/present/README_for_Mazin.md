# UBAR presentation page, for ubar.space

**What it is:** the judges' presentation as one scroll-down page. The live site is embedded as one slide, so there's no tab switch. The site's **About** link opens this page.

**Install:**
1. Copy this `present/` folder to the site root, next to `index.html`, so it is served at `https://ubar.space/present/`.
2. The website slide embeds the same site once and steps it through `#orbit` → `#director` → `#oman` → `#site-S05` by changing its hash, so the site's own transitions play. It is same-origin, so nothing needs configuring.
3. The live site loads when you are on the slide before it and unloads two slides later, to keep the GPU free.

**Controls:**

| Key | Action |
|---|---|
| ↓ / ↑, PageDown / PageUp, Space, or a clicker | Next / previous slide; on the website slide, PageDown / PageUp / Space step through the site first |
| F | Fullscreen |
| N | Speaker notes bar |
| Esc | Inside the live site: give the keys back to the presentation |

- On the website slide, the arrow keys and mouse belong to the site. PageDown/PageUp (the clicker) still move the presentation.
- The dots on the right jump to any slide. The orange dot is the website slide.
- In `js/main.js`, the site detects it is inside the deck (`.framed`) and hides its About link and bottom-right controls.
- `https://ubar.space/present/#wf1` opens the deck at a given slide.

**Notes:**
- No build step and no dependencies. Fonts come from Google Fonts, with a system fallback.
- If the site uses a Content-Security-Policy, allow `fonts.googleapis.com` and `fonts.gstatic.com`.
