// Metro configuration for a pnpm monorepo.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// The workspace root is watched so edits in `packages/*` trigger a rebuild:
// they are consumed as TypeScript source, not as built output.
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Hierarchical lookup must stay ON under pnpm. The usual monorepo advice to
// disable it targets npm and yarn, where every package is hoisted to one flat
// root and walking up parent directories only finds duplicates. pnpm's layout
// is the opposite: `expo` lives in `.pnpm/expo@<version>/node_modules/expo`
// with its own dependencies -- `expo-modules-core` and friends -- as siblings
// inside that same directory. Walking up from the importing file is precisely
// what finds them, so disabling it breaks resolution of every transitive
// native module.
config.resolver.disableHierarchicalLookup = false;

// Symlinks are how pnpm links workspace packages and the virtual store.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
