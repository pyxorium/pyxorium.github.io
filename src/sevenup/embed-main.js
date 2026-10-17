// Entry point for the Seven-Up table embedded in a blog post (src/components/SevenUpDemo.astro).
// No sign-in library here: the embed doesn't save.
import { TileMothership, Tile } from '@dasl/tile-loader';
import { MemoryTileLoader } from '@dasl/tile-loader/memory';
import { mountEmbed } from './embed.js';

const root = document.getElementById('sevenup');
if (root) mountEmbed(root, { TileMothership, MemoryTileLoader, Tile });
