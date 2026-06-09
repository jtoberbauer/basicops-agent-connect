#!/usr/bin/env node
// Silence noisy transitive deprecation warnings (e.g. punycode DEP0040) before
// loading the app, so the interactive installer prompts stay clean.
(process as any).emitWarning = () => {};
await import("./cli.js");
