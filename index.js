'use strict';

module.exports = extract;

var MBTiles = require('@mapbox/mbtiles');
var split = require('split');
var whichPoly = require('which-polygon');
var queue = require('queue-async');
var path = require('path');
var SphericalMercator = require('@mapbox/sphericalmercator');
var mkdirp = require('mkdirp');

var sm = new SphericalMercator();

function extract(mbTilesPath, geojson, propName) {
    if (!propName) throw new Error('Property name to extract by not provided.');

    var query = whichPoly(geojson);
    var tilesGot = 0;
    var tilesDone = 0;
    var paused = false;
    var pauseLimit = 100;
    var extracts = {};

    var timer = setInterval(updateStatus, 64);

    var db = new MBTiles(mbTilesPath, function (err) {
        if (err) throw err;

        var zxyStream = db.createZXYStream({batch: pauseLimit}).pipe(split());
        var ended = false;
        var writeQueue = {};
        var writable = {};

        zxyStream
            .on('data', onData)
            .on('end', onEnd);

        function onEnd() {
            ended = true;
            if (tilesDone === tilesGot) shutdown();
        }

        function onData(str) {

            tilesGot++;

            var tile = str.split('/');
            var z = +tile[0];
            var x = +tile[1];
            var y = +tile[2];

            if (!paused && tilesGot - tilesDone > pauseLimit) {
                zxyStream.pause();
                paused = true;
            }

            var result = query(unproject(z, x + 0.5, y + 0.5));

            if (!result) {
                process.nextTick(tileSaved);
            } else {
                var extractName = toFileName(result[propName]);

                if (extracts[extractName] && writable[extractName]) {
                    saveTile(extracts[extractName], z, x, y);

                } else {

                    writeQueue[extractName] = writeQueue[extractName] || [];
                    writeQueue[extractName].push([z, x, y]);

                    if (!extracts[extractName]) {
                        writeExtract(extractName, function () {
                            writable[extractName] = true;
                            while (writeQueue[extractName].length) {
                                var t = writeQueue[extractName].pop();
                                saveTile(extracts[extractName], t[0], t[1], t[2]);
                            }
                        });
                    }
                }
            }
        }

        function saveTile(out, z, x, y) {
            db.getTile(z, x, y, function (err, data) {
                if (err) throw err;
                out.putTile(z, x, y, data, tileSaved);
            });
        }

        function tileSaved(err) {
            if (err) throw err;

            tilesDone++;

            if (paused && tilesGot - tilesDone < pauseLimit / 2) {
                paused = false;
                zxyStream.resume();
            }

            if (ended && tilesDone === tilesGot) shutdown();
        }

        function shutdown() {

            db.getInfo(function (err, info) {
                if (err) throw err;


                var updateQ = queue();
                for (var id in extracts) {
                    updateQ.defer(updateInfo, extracts[id], id, info);
                }

                updateQ.awaitAll(function (err, extracts) {
                    if (err) throw err;

                    var doneQ = queue();
                    var length = extracts.length;
                    for (var i = 0; i < length; i++) {
                        doneQ.defer(extracts[i].stopWriting.bind(extracts[i]));
                    }

                    doneQ.await(function (err) {
                        if (err) throw err;

                        clearInterval(timer);
                        updateStatus();
                        process.stderr.write('\n');
                        db.close();
                    });

                });
            });

        }
    });

    function writeExtract(name, done) {
        var subfolderName = path.basename(mbTilesPath, '.mbtiles');
        var dirPath = path.dirname(mbTilesPath);
        var subfolderPath = path.join(dirPath, subfolderName);
        mkdirp.sync(subfolderPath);
        var writePath = path.join(subfolderPath, name);
        extracts[name] = writeMBTiles(writePath, done);
        return extracts[name];
    }

    function updateStatus() {
        if (!process.stderr.cursorTo) return;

        process.stderr.cursorTo(0);
        process.stderr.write('tiles processed: ' + tilesDone);
    }
}

function toFileName(name) {
    return name.toLowerCase().replace(/ /g, '_') + '.mbtiles';
}

function writeMBTiles(path, done) {
    var out = new MBTiles(path, function (err) {
        if (err) throw err;
        out.startWriting(readyToWrite);
    });
    function readyToWrite(err) {
        if (err) throw err;
        done(null, out);
    }
    return out;
}

function unproject(z, x, y) {
    var z2 = Math.pow(2, z);
    var lng = x * 360 / z2 - 180;
    var lat = 360 / Math.PI * Math.atan(Math.exp((180 - y * 360 / z2) * Math.PI / 180)) - 90;
    return [lng, lat];
}

function updateInfo(mbtiles, name, info, callback) {
    mbtiles._db.get(
        'SELECT MAX(tile_column) AS maxx, ' +
        'MIN(tile_column) AS minx, MAX(tile_row) AS maxy, ' +
        'MIN(tile_row) AS miny FROM tiles ' +
        'WHERE zoom_level = ?',
        info.minzoom,
        function (err, row) {
            if (err) {
                callback(err);
                return;
            }
            if (!row) {
                callback(null, info);
                return;
            }

            // @TODO this breaks a little at zoom level zero
            var urTile = sm.bbox(row.maxx, row.maxy, info.minzoom, true);
            var llTile = sm.bbox(row.minx, row.miny, info.minzoom, true);
            // @TODO bounds are limited to "sensible" values here
            // as sometimes tilesets are rendered with "negative"
            // and/or other extremity tiles. Revisit this if there
            // are actual use cases for out-of-bounds bounds.

            info.bounds = [
                llTile[0] > -180 ? llTile[0] : -180,
                llTile[1] > -90 ? llTile[1] : -90,
                urTile[2] < 180 ? urTile[2] : 180,
                urTile[3] < 90 ? urTile[3] : 90
            ];

            var numLayers = info.vector_layers.length;
            var range = info.maxzoom - info.minzoom;
            info.center = [
                (info.bounds[2] - info.bounds[0]) / 2 + info.bounds[0],
                (info.bounds[3] - info.bounds[1]) / 2 + info.bounds[1],
                range <= 1 ? info.maxzoom : Math.floor(range * 0.5) + info.minzoom
            ];
            info.name = info.description = info.basename = name;

            for (var i = 0; i < numLayers; i++) {
                info.vector_layers[i].fields = {};
            }

            mbtiles.putInfo(info, function (err) {
                if (err) throw err;

                return callback(null, mbtiles);
            });
        }
    );
}
