// Bundler settings: Expo's defaults, plus `.wasm` as an asset so the web build can load
// expo-sqlite's database engine (wa-sqlite.wasm). Phones are not affected.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('wasm');

module.exports = config;
