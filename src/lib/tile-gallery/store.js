// In-memory state shared by the sources, the live feed and the renderer.

export class TileStore {
	constructor() {
		this.tiles = new Map(); // at-uri -> tile
		this.authors = new Map(); // did -> { did, handle, pds, verified }
		this.listeners = new Set();
		this._queued = false;
	}

	onChange(fn) {
		this.listeners.add(fn);
	}

	// Coalesce many changes into one render per animation frame.
	changed() {
		if (this._queued) return;
		this._queued = true;
		requestAnimationFrame(() => {
			this._queued = false;
			this.listeners.forEach((fn) => fn());
		});
	}

	put(tile) {
		this.tiles.set(tile.uri, tile);
		this.changed();
	}

	remove(uri) {
		if (this.tiles.delete(uri)) this.changed();
	}
}
