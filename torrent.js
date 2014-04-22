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
TorrentEngine.id = null;
TorrentEngine.opts = {
    connections: 100,
    path: null,
    verify: true,
    dht: 10000,
    tracker: true
};
TorrentEngine.total_pieces = 0;
TorrentEngine.finished_pieces = 0;
TorrentEngine.connect = [];

var engine;
var ephemeral = false;
var wait = false;
var download_snapshot = 0;

TorrentEngine.load = function(torrent, opts, cb) {
    // Missing argument
    if(!torrent) {
        return cb(null);
    }

    // Compute download id
    var md5 = crypto.createHash("md5");
    md5.update(torrent);
    TorrentEngine.id = md5.digest("hex");
    TorrentEngine.opts.path = path.join(process.cwd(), TorrentEngine.id);

    // Copy options
    var opts_mapping = {
        c: "connections",
        b: "path",
        V: ["verify", false],
        d: "dht",
        T: ["tracker", false]
    };

    for(var key in opts) {
        var mapping = opts_mapping[key];
        if(mapping) {
            if(Array.isArray(mapping)) {
                TorrentEngine.opts[mapping[0]] = mapping[1];
            } else {
                TorrentEngine.opts[mapping] = opts[key];
            }
        }
    }

    if(opts.p) {
        if(Array.isArray(opts.p)) {
            TorrentEngine.connect = opts.p;
        } else {
            TorrentEngine.connect.push(opts.p);
        }
    }

    if(opts.c) { TorrentEngine.opts.connections = opts.c; }
    if(opts.b) { TorrentEngine.opts.path = opts.b; }
    if(opts.n) { TorrentEngine.opts.verify = false; }
    if(opts.d) { TorrentEngine.opts.dht = opts.d; }
    if(opts.t) { TorrentEngine.opts.tracker = false; }
    if(opts.e) { ephemeral = true; }
    if(opts.w) { ephemeral = wait = true; }

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
    TorrentEngine.engine = engine = torrentStream(torrent, opts || TorrentEngine.opts);
    engine.on("ready", function() {
        TorrentEngine.ready = true;
        TorrentEngine.total_pieces = engine.torrent.pieces.length;
        TorrentEngine.torrent = engine.torrent;
        TorrentEngine.wires = engine.swarm.wires;
        TorrentEngine.files = engine.files.filter(function(file) {
            return true;
        });

        if(!wait) {
            TorrentEngine.files.forEach(function(file) {
                file.select();
            });
        }

        for(var i = 0; i < TorrentEngine.total_pieces; i++) {
            if(engine.bitfield.get(i)) {
                ++TorrentEngine.finished_pieces;
            }
        }
        TorrentEngine._checkDone();

        engine.on("verify", function() {
            download_snapshot = engine.swarm.downloaded;
            ++TorrentEngine.finished_pieces;
            TorrentEngine._checkDone();
        });

        TorrentEngine.connect.forEach(function(peer) {
            engine.connect(peer);
        });

        TorrentEngine.emit("ready");
    });
};

TorrentEngine._checkDone = function() {
    if(TorrentEngine.finished_pieces == TorrentEngine.total_pieces) {
        TorrentEngine._writeFiles();
    }
};

var writing_files = false;
TorrentEngine._writeFiles = function() {
    if(writing_files) return;
    writing_files = true;

    if(ephemeral) {
        TorrentEngine.done = true;
        TorrentEngine.emit("done");
        return;
    }

    var files_done = 0;
    TorrentEngine.files.forEach(function(file) {
        var file_dir = path.join(".", path.dirname(file.path));
        if(file_dir != ".") {
            mkdirp.sync(file_dir);
        }

        var s_out = fs.createWriteStream(file.path + ".tmp");
        var s_in = file.createReadStream();

        s_out.on("close", function() {
            fs.renameSync(file.path + ".tmp", file.path);
            if(++files_done >= TorrentEngine.files.length) {
                TorrentEngine.done = true;
                TorrentEngine.emit("done");
            }
        })

        s_in.pipe(s_out);
    });
};

TorrentEngine.downloadPercent = function() {
    return Math.floor((TorrentEngine.finished_pieces/TorrentEngine.total_pieces) * 100);
};

TorrentEngine.downloadSpeed = function() {
    return engine.swarm.downloadSpeed();
};

TorrentEngine.downloadedBytes = function() {
    return (TorrentEngine.finished_pieces * engine.torrent.pieceLength) + (engine.swarm.downloaded - download_snapshot);
};

TorrentEngine.exit = function(purge, cb) {
    engine.destroy(function() {
        if(purge) {
            engine.remove(function() {
                cb()
            });
        } else {
            cb()
        }
    });
};

module.exports = TorrentEngine;
