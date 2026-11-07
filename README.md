# SATIQ / PrepOrbit AI SAT Studio

React + TypeScript SAT preparation application with a local mode and a deployed Railway/PostgreSQL version.

**[Open PrepOrbit AI](https://waypoint-web-production-50a5.up.railway.app/)** · [Daily Plan](https://waypoint-web-production-50a5.up.railway.app/#plan) · [Guided Tutor](https://waypoint-web-production-50a5.up.railway.app/#tutor) · [Mistake Analysis](https://waypoint-web-production-50a5.up.railway.app/#analysis)

The application is in **[`waypoint-sat/`](waypoint-sat/)**. See its **[README](waypoint-sat/README.md)** for setup, learning flows, storage behavior, tests, and Railway deployment instructions.

```sh
cd waypoint-sat
npm ci
npm run dev
```

All fourteen screens are available in a persistent grouped left menu: the original four SAT Studio screens, four Learning Companion screens, and six Practice Intelligence screens. On phones, open **Menu** to choose a screen. The AI Assistant combines the current study profile from PostgreSQL with GPT answers. Guided Tutor and mistake-analysis guidance remain scripted; handwriting transcription remains manual. SAT score estimates remain unavailable without a validated scoring method.

Source, tests, original design references, and deployment screenshots are included. Installed dependencies, generated builds, test output, and secrets are excluded from Git.

The Railway service currently uses CLI source uploads. This push does not enable automatic deployment from GitHub. If connecting this repository to Railway later, set the service root directory to `/waypoint-sat` and retain the existing database variables.
