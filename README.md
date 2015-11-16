## MBTiles Extracts

A tool to extract parts of an MBTiles file into separate files using a GeoJSON with polygons (e.g. split world data into countries).

Usage:

```bash
$ mbtiles-extracts <MBTiles path> <GeoJSON path> <property name>
```

Example:

```bash
$ mbtiles-extracts planet.mbtiles countries.json admin
```
