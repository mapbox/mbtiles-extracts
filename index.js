'use strict';

module.exports = extract;

var MBTiles = require('mbtiles');
var split = require('split');
var tilebelt = require('tilebelt');
var whichPoly = require('which-polygon');
var queue = require('queue-async');
var path = require('path');

function extract(mbTilesPath, geojson) {
    var query = whichPoly(geojson);

    var tilesGot = 0;
    var tilesDone = 0;
    var paused = false;
    var pauseLimit = 100;
    var extracts = {};

    var timer = setInterval(updateStatus, 64);

    var db = new MBTiles(mbTilesPath, function (err, db) {
        if (err) throw err;

        var zxyStream = db.createZXYStream({batch: pauseLimit}).pipe(split());
        var ended = false;

        zxyStream.on('data', function (str) {

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
                var extractName = toFileName(result.admin);

                if (extracts[extractName]) {
                    saveTile(extracts[extractName], z, x, y);

                } else {
                    zxyStream.pause();
                    writeExtract(extractName, function () {
                        zxyStream.resume();
                        saveTile(extracts[extractName], z, x, y);
                    });
                }
            }
        }).on('end', function () {
            ended = true;
        });

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

            if (ended && tilesDone === tilesGot) {
                shutdown();
            }
        }

        function shutdown() {
            var doneQ = queue();
            for (var id in extracts) {
                doneQ.defer(extracts[id].stopWriting.bind(extracts[id]));
            }
            doneQ.defer(db.close.bind(db));

            doneQ.await(function () {
                clearInterval(timer);
            });
        }
    });

    function writeExtract(name, done) {
        var subfolderName = path.basename(mbTilesPath, '.mbtiles');
        var dirName = path.dirname(mbTilesPath);
        var writePath = path.join(dirName, subfolderName, name);
        extracts[name] = writeMBTiles(writePath, done);
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

function stopWriting(db, done) {
    db.stopWriting(done);
}

function unproject(z, x, y) {
  var z2 = Math.pow(2, z);
  var lng = x * 360 / z2 - 180;
  var lat = 360 / Math.PI * Math.atan(Math.exp((180 - y * 360 / z2) * Math.PI / 180)) - 90;
  return [lng, lat];
}
