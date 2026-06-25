# AGENTS.md

## Repository Role

This is the public Everfind mobile app. It must build and provide local inventory functionality without the private cloud repository.

## Commands

```bash
npm test
npm run lint
npm run start:foss
```

## Boundaries

- Keep offline inventory, local persistence, local images, search, and import/export public.
- New cloud, authentication, collaboration, analytics, MCP, and premium implementations belong in `../everfind-cloud`.
- Access optional functionality through `utils/edition` capability APIs.
- Never add backend credentials or production service defaults.
- Preserve Expo Router navigation and the existing offline-first data lifecycle.
