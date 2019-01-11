# MBTiles Extracts

A tool to extract parts of an MBTiles file into separate files using a GeoJSON with polygons (e.g. split world data into countries). 

## Results from mbtiles-extracts
The `mbtiles-extracts` tool extracts all **tiles** intersecting with the polygons in the GeoJSON. For example:

### For a given polygon in an mbtiles file
<img width="373" alt="screen shot 2018-11-11 at 1 46 52 pm" src="https://user-images.githubusercontent.com/3166852/48310818-50150500-e5bb-11e8-8a16-2c080211eccf.png">

### `mbtiles-extracts` returns
<img width="636" alt="screen shot 2018-11-11 at 1 46 18 pm" src="https://user-images.githubusercontent.com/3166852/48310817-50150500-e5bb-11e8-93f0-fa4db5d0f32f.png">

### NOT
<img width="415" alt="screen shot 2018-11-11 at 2 10 10 pm" src="https://user-images.githubusercontent.com/3166852/48310834-a7b37080-e5bb-11e8-9ecb-a8204febafd5.png">

## Usage:

```
npm install mbtiles-extracts
```

```bash
$ mbtiles-extracts <MBTiles path> <GeoJSON path> <property name>
```

## Example:

```bash
$ mbtiles-extracts planet.mbtiles countries.json admin
```
