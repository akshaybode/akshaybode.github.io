# Akshay Bode — Data Engineer Portfolio

###### https://akshaybode.github.io/

A modern, single-page portfolio website built for a **Data Engineer** profile.
Self-contained (vanilla HTML, CSS & JavaScript) — no build step required.

## Sections
* **Hero** — animated particle-network background, rotating role text, quick links
* **Pipeline strip** — animated Sources → Ingest → Transform → Warehouse → Analytics flow
* **About** — bio + animated stat counters (years, records/day, performance gains)
* **Skills** — categorized tech chips + animated proficiency bars
* **Experience** — interactive timeline (Amdocs incl. onsite USCC migration in Mexico, IBM)
* **Projects** — data engineering builds (ELT pipeline, real-time CDC, migration, modeling)
* **Certifications** — DP-900, Big Data 101, AZ-900, AI-900, IBM Cloud, SnowPro Core (in progress)
* **Contact** — email, social links, location

## Tech / UX features
* Scroll-reveal animations (IntersectionObserver)
* Sticky nav with scroll progress bar + active-section highlighting (scrollspy)
* Animated counters and skill bars
* Typing/rotating headline effect
* Light / dark theme toggle (persisted in `localStorage`)
* Canvas particle "data network" hero background
* Fully responsive + `prefers-reduced-motion` friendly

## Stack
* HTML5, CSS3 (custom properties, grid/flex, keyframe animations)
* Vanilla JavaScript (no frameworks)
* Google Fonts (Inter, Space Grotesk, JetBrains Mono) + Font Awesome icons (CDN)

## Run locally
Just open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 8000
# then visit http://localhost:8000
```

## Deploy
Hosted on **GitHub Pages** from the repository root. Push to the default branch and Pages serves `index.html`.
