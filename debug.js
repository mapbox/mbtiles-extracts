'use strict';

var path = require('path');
var extract = require('./');
var polygons = require('./states.json');

extract(path.join(__dirname, '../mbtiles/us-west.mbtiles'), polygons, 'states');
