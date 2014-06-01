/*
    Copyright (c) 2014 Bastien Clément

    Permission is hereby granted, free of charge, to any person obtaining a
    copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to
    the following conditions:

    The above copyright notice and this permission notice shall be included
    in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
    OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
    IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
    CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
    TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
    SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

var fs = require("fs");
var path = require("path");
var events = require("events");
var crypto = require("crypto");
var mkdirp = require("mkdirp");
var torrentStream = require("torrent-stream");

var TorrentEngine = new events.EventEmitter();

TorrentEngine.ready = false;
TorrentEngine.done = false;
TorrentEngine.opts = {
    connections: 100,
    uploads: 10,
    path: process.cwd(),
    verify: true,
    dht: 10000,
    tracker: true,
    name: "tget"
};
TorrentEngine.total_pieces = 0;
TorrentEngine.finished_pieces = 0;
TorrentEngine.connect = [];

var engine;
var ephemeral = false;
var wait = false;
var download_snapshot = 0;

function checkDone() {
    if(TorrentEngine.finished_pieces == TorrentEngine.total_pieces) {
        TorrentEngine.done = true;
        TorrentEngine.emit("done");
    }
};

TorrentEngine.load = function(torrent, opts, cb) {
    // Missing argument
    if(!torrent) {
        return cb(null);
    }

    // Options
    if(opts.c) { TorrentEngine.opts.connections = opts.c; }
    if(opts.d) { TorrentEngine.opts.dht = (!opts.d || opts.d === true) ? false : opts.d; }
    if(opts.t) { TorrentEngine.opts.tracker = false; }
    if(opts.u) { TorrentEngine.opts.uploads = opts.u; }
    if(opts.w) { wait = true; }

    if(opts.e) {
        ephemeral = true;
        TorrentEngine.opts.path = null;  // Will download to /tmp
    }

    if(opts.p) {
        if(Array.isArray(opts.p)) {
            TorrentEngine.connect = opts.p;
        } else {
            TorrentEngine.connect.push(opts.p);
        }
    }

    // Magnet link
    if(torrent.slice(0, 7) == "magnet:") {
        return cb(torrent);
    }

    // HTTP link
    var https = torrent.slice(0, 8) == "https://";
    if(https || torrent.slice(0, 7) == "http://") {
        var http = require(https ? "https" : "http");
        http.get(torrent, function(res) {
            var buffers = [];

            res.on("data", function(data) {
                buffers.push(data);
            })

            res.on("end", function() {
                cb(Buffer.concat(buffers));
            })
        });
        return;
    }

    // Attempt to read a local file
    return cb(fs.readFileSync(torrent));
};

TorrentEngine.init = function(torrent, opts) {
    // TorrentStream instance
    TorrentEngine.engine = engine = torrentStream(torrent, opts || TorrentEngine.opts);

    // Explicit peer connection
    TorrentEngine.connect.forEach(function(peer) {
        engine.connect(peer);
    });

    // Wait for torrent metadata to be available
    engine.on("ready", function() {
        TorrentEngine.ready = true;
        TorrentEngine.total_pieces = engine.torrent.pieces.length;
        TorrentEngine.torrent = engine.torrent;
        TorrentEngine.wires = engine.swarm.wires;
        TorrentEngine.files = engine.files.filter(function(file) {
            // TODO: maybe a filtering option
            return true;
        });

        // Start the download of every file (unless -w)
        if(!wait) {
            TorrentEngine.files.forEach(function(file) {
                file.select();
            });
        }

        // Resuming a download ?
        for(var i = 0; i < TorrentEngine.total_pieces; i++) {
            if(engine.bitfield.get(i)) {
                ++TorrentEngine.finished_pieces;
            }
        }
        checkDone();

        // New piece downlaoded
        engine.on("verify", function() {
            download_snapshot = engine.swarm.downloaded;
            ++TorrentEngine.finished_pieces;
            checkDone();
        });

        // Pause or resume the swarm when interest changes
        engine.on("uninterested", function() { engine.swarm.pause(); });
        engine.on("interested", function() { engine.swarm.resume(); });

        // We're ready
        TorrentEngine.emit("ready");
    });
};

TorrentEngine.downloadPercent = function() {
    // Return range: 0-100
    return Math.floor((TorrentEngine.finished_pieces/TorrentEngine.total_pieces) * 100);
};

TorrentEngine.downloadSpeed = function() {
    return engine.swarm.downloadSpeed();
};

TorrentEngine.downloadedBytes = function() {
    return (TorrentEngine.finished_pieces * engine.torrent.pieceLength) + (engine.swarm.downloaded - download_snapshot);
};

TorrentEngine.exit = function(cb) {
    engine.destroy(function() {
        if(ephemeral || TorrentEngine.done) {
            engine.remove(!ephemeral, function() {
                cb()
            });
        } else {
            cb();
        }
    });
};

module.exports = TorrentEngine;
