# SATIQ / Waypoint SAT Studio

React + TypeScript SAT preparation application with a local mode and a deployed Railway/PostgreSQL version.

**[Open Waypoint](https://waypoint-web-production-50a5.up.railway.app/)** · [Daily Plan](https://waypoint-web-production-50a5.up.railway.app/#plan) · [Guided Tutor](https://waypoint-web-production-50a5.up.railway.app/#tutor) · [Mistake Analysis](https://waypoint-web-production-50a5.up.railway.app/#analysis)

The application is in **[`waypoint-sat/`](waypoint-sat/)**. See its **[README](waypoint-sat/README.md)** for setup, learning flows, storage behavior, tests, and Railway deployment instructions.

```sh
cd waypoint-sat
npm ci
npm run dev
```

All thirteen screens are available in a persistent grouped left menu: the original four SAT Studio screens, three Learning Companion screens, and six Practice Intelligence screens. On phones, open **Menu** to choose a screen. Tutor and mistake-analysis guidance is explicitly scripted; no live AI provider or handwriting recognition service is connected. SAT score estimates remain unavailable without a validated scoring method.

Source, tests, original design references, and deployment screenshots are included. Installed dependencies, generated builds, test output, and secrets are excluded from Git.

The Railway service currently uses CLI source uploads. This push does not enable automatic deployment from GitHub. If connecting this repository to Railway later, set the service root directory to `/waypoint-sat` and retain the existing database variables.
