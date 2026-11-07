# Map libraries (vendored)

Loaded only when someone opens the Map view (public/app.js, `loadMapLibs`), from this site rather
than a CDN. Unmodified copies of the npm packages' browser builds:

| File | Package | Version | Licence |
|---|---|---|---|
| maplibre-gl.js, maplibre-gl.css | [maplibre-gl](https://github.com/maplibre/maplibre-gl-js) | 5.24.0 | BSD-3-Clause (LICENSE-maplibre-gl.txt) |
| pmtiles.js | [pmtiles](https://github.com/protomaps/PMTiles) | 4.5.0 | BSD-3-Clause |
| basemaps.js | [@protomaps/basemaps](https://github.com/protomaps/basemaps) | 5.7.2 | BSD-3-Clause |

To update: `npm pack` the new versions, copy the same files from each package's `dist/`, and change
the table. Map data is © OpenStreetMap contributors (ODbL), cut per region by scripts/build-maps.mjs.
