'use strict';

module.exports = extract;

var MBTiles = require('mbtiles');
var split = require('split');
var whichPoly = require('which-polygon');
var queue = require('queue-async');
var path = require('path');
var mkdirp = require('mkdirp');

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
            var doneQ = queue();
            for (var id in extracts) {
                doneQ.defer(extracts[id].stopWriting.bind(extracts[id]));
            }
            doneQ.defer(db.close.bind(db));

            doneQ.await(function (err) {
                if (err) throw err;
                clearInterval(timer);
                updateStatus();
                process.stderr.write('\n');
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
