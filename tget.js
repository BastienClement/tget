#!/usr/bin/env node
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

var StreamServer = require("./stream");
var TorrentEngine = require("./torrent");
var utils = require("./utils");
var fs = require("fs");
var path = require("path");
var readline = require("readline");
var argv = require("rc")("tget");

// Alias long options
if(argv.connections) argv.c = argv.connections;
if(argv.dht) argv.d = argv.dht;
if(argv.ephemeral) argv.e = argv.ephemeral;
if(argv.idle) argv.i = argv.idle;
if(argv.listen) argv.l = argv.listen;
if(argv.peer) argv.p = argv.peer;
if(argv.quiet) argv.q = argv.quiet;
if(argv.stream) argv.s = argv.stream;
if(argv.notracker) argv.t = argv.notracker;
if(argv.uploads) argv.u = argv.uploads;
if(argv.wait) argv.w = argv.wait;

// Options check
if(argv.w && !argv.s) {
    console.error("-w option requires -s");
    return;
}

if(argv.w) {
    argv.e = true;
    argv.i = true;
}

var verbose = !argv.q;

//
// File stream mode
//
if(argv.S) {
    var local_path;
    if(!(local_path = argv._[0])) {
        local_path = argv.S;
        argv.S = 8888;
    }

    if(!fs.existsSync(local_path)) {
        console.error("Usage: tget -S [port] <path>");
        return;
    }

    var files = [];

    function torrentize(file) {
        var stat = fs.lstatSync(file);
        if(stat.isDirectory()) {
            fs.readdirSync(file).forEach(function(sub_file) {
                torrentize(path.join(file, sub_file));
            });
        } else {
            files.push({
                name: file,
                length: stat.size,
                createReadStream: function(opts) {
                    return fs.createReadStream(file, opts);
                }
            });
        }
    }

    // Fake torrent-stream files structure
    torrentize(local_path);

    StreamServer.init(argv.S, files);

    if(verbose) {
        console.log("Available files:");
        files.forEach(function(file, i) {
            console.log("  [" + (i+1) + "] " + file.name);
        });

        console.log("\nLocal streaming enabled on port " + StreamServer.port + " (default file is " + StreamServer.def_idx + ")");
    }
    return;
}

//
// Torrent download mode
//
TorrentEngine.load(argv._[0], argv, function(torrent) {
    // Missing or invalid argument
    if(!torrent) {
        console.error("Usage: tget <path|url|magnet> [options]");
        return;
    }

    TorrentEngine.init(torrent);

    // Exit safety check
    function exit(force) {
        if(!force && (!TorrentEngine.done || StreamServer.open_streams > 0 || argv.i)) return;

        TorrentEngine.exit(function() {
            rl.write("\n");
            rl.close();
            process.exit(0);
        });
    }

    // Create command line interface
    var rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Forceful exit
    rl.on("SIGINT", function() {
        exit(true);
    });

    rl.setPrompt("");
    if(verbose) rl.write("Initializing torrent engine...");

    TorrentEngine.on("ready", function() {
        if(verbose) {
            rl.write(" Ready.\n\n");

            rl.write("Downloading files:\n");
            TorrentEngine.files.forEach(function(file, i) {
                rl.write("  [" + (i+1) + "] " + file.path + "\n");
            });

            rl.write("\n");
        }

        function print_progress() {
            var buf = [];

            // Percent indicator
            var percent = TorrentEngine.downloadPercent();
            buf.push(utils.pad(percent, 3) + "%");
            buf.push(" ");

            // Progress bar
            var twens_percent = Math.floor(percent*2.5/10);
            buf.push("[");
            buf.push("==============================".slice(0, twens_percent));
            buf.push(twens_percent ? ">" : " ");
            buf.push("                              ".slice(0, 25-twens_percent));
            buf.push("]");
            buf.push("  ");

            // Downloaded bytes
            buf.push(utils.bytes(TorrentEngine.downloadedBytes()));
            buf.push("  ");

            // Download speed
            buf.push(utils.bytes(TorrentEngine.downloadSpeed()));
            buf.push("/s");
            buf.push("  ");

            // Peers informations
            function active(wire) {
                return !wire.peerChoking;
            }

            buf.push(TorrentEngine.wires.filter(active).length);
            buf.push("/");
            buf.push(TorrentEngine.wires.length);
            buf.push(" peers");
            buf.push("  ");

            // Stream informations
            if(StreamServer.enabled) {
                buf.push(StreamServer.open_streams);
                buf.push(" streams");
            }

            rl.write(buf.join(""));
        }

        function clear_line() {
            // Erase the last printed line
            rl.write("", { ctrl: true, name: "u" });
        }

        var throttle = false;
        function update_gui(done) {
            if(done || !throttle) {
                clear_line();
                print_progress();
                throttle = true;
                setTimeout(function() {
                    throttle = false;
                }, 1000);
            }
        }

        if(verbose) setInterval(update_gui, 1000);

        // Download is fully done
        TorrentEngine.on("done", function() {
            if(verbose) update_gui(true);
            exit(false);
        });

        // Init streaming server
        if(argv.s) {
            StreamServer.init(argv.s, TorrentEngine.files);

            if(verbose) {
                rl.write("Streaming enabled on port " + StreamServer.port);
                if(StreamServer.use_m3u) {
                    rl.write(" (using m3u playlist)");
                } else {
                    rl.write(" (default file is " + StreamServer.def_idx + ")");
                }
                rl.write("\n\n");
            }

            StreamServer.on("stream-close", function() {
                exit(false);
            });
        }

        // Initial progress bar painting
        if(verbose) update_gui();
    });
});
