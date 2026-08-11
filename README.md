# RA4 Eyes

RA4 Eyes is a static web app for estimating RA-4 color print viewing filter corrections from a live camera feed.

It runs directly on GitHub Pages with no build step. Open `index.html`, or publish the repository root as a GitHub Pages site.

## What it does

- Starts a camera preview in the browser.
- Samples a neutral print area in the center reticle.
- Simulates ideal cyan, magenta, and yellow viewing filters.
- Auto-balances the sampled patch into a CMY correction pack.
- Adds the correction to an entered current enlarger pack.
- Calculates estimated viewing-filter light loss and neutral-density exposure compensation.

## Notes

The app uses ideal CC density math, where 30.1 CC is one stop of neutral density. Real RA-4 materials and enlarger color heads are not ideal, so the result should be treated as a fast starting point for a confirmation strip.

Camera access requires HTTPS or localhost. GitHub Pages provides HTTPS automatically.
