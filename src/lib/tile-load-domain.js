// The tile loading server every embedded tile on this site goes through
// (blog embeds, the gallery Preview and the demos). Change it here only.
//
// load.tiles.lexicographer.space gives each tile its own random name, so every
// tile runs on its own origin with its own service worker (the owner's Fly.io
// app `tiles-loading-server`, wildcard DNS at Cloudflare). The old
// load.tiles.thunderbird.cafe (five fixed names, tile1 to tile5, because Wix has
// no wildcard records) still works for embeds elsewhere but isn't used here:
// two tiles on one name could break each other. See
// claude/tile-loading-findings.md in the Foundry project.
export const TILE_LOAD_DOMAIN = 'load.tiles.lexicographer.space';
