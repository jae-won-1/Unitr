// Metro config for the Uniter mobile app.
//
// This app lives inside the web app's repo and shares its business logic by
// IDENTITY, not by copying: `@shared/lib/...` resolves to the same ../lib files
// the Next.js app imports as `@/lib/...`. Change a rule once, both clients get it.
//
// Two deliberate departures from Expo's stock monorepo recipe, both because the
// parent directory is a *Next.js app* rather than a neutral workspace root:
//
//  1. watchFolders lists ../lib and ../contexts specifically, never the repo
//     root. Watching the root would drag the web app's node_modules, .next and
//     40+ SQL files into Metro's file graph for no benefit.
//
//  2. The parent node_modules is BLOCKED outright. It belongs to the web app
//     and holds React 18 + react-dom for Next; this app is on React 19 + React
//     Native. If Metro were allowed to walk up into it we would get two Reacts
//     in one bundle — the classic invalid-hook-call crash, and a confusing one
//     here because the second React is a perfectly legitimate install.
//
//     Note this is a blockList and NOT `disableHierarchicalLookup`, which was
//     tried first and is too blunt: it also stops Metro resolving *nested*
//     dependencies inside this app. npm hoists semver@6 to mobile/node_modules
//     while react-native-reanimated needs semver@7 from its own nested copy —
//     with hierarchical lookup off, reanimated resolves the hoisted v6, finds
//     no semver/functions/satisfies (a v7-only path) and the bundle dies.
//     Blocking one directory keeps normal nested resolution intact.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Shared source that lives outside this app's folder. Metro will not bundle a
// file it is not watching, so these must be listed explicitly.
config.watchFolders = [
  path.resolve(repoRoot, "lib"),
  path.resolve(repoRoot, "contexts"),
];

// See note 2 above — never resolve up into the web app's dependency tree.
// Anchored on the repo root's own node_modules, which this app's
// (…/unitr/mobile/node_modules) does not match, so only the web app's is hidden.
const webModules = path
  .resolve(repoRoot, "node_modules")
  .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
config.resolver.blockList = [
  ...[config.resolver.blockList ?? []].flat(),
  new RegExp(`^${webModules}[\\\\/]`),
];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

// Must mirror the "paths" in tsconfig.json, or the editor and the bundler will
// disagree about what an import means.
config.resolver.alias = {
  ...(config.resolver.alias ?? {}),
  "@shared/lib": path.resolve(repoRoot, "lib"),
  "@shared/contexts": path.resolve(repoRoot, "contexts"),
};

module.exports = config;
