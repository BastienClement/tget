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
var argv = require("minimist")(process.argv.slice(2));

/**
 *  OPTION      DESCRIPTION                             DEFAULT         NOTES
 *  --------------------------------------------------------------------------------
 *  -b PATH     Buffer path                             md5(magnet)     -
 *  -c NUM      Maximum connections                     100             -
 *  -d NUM      Number of DHT peers to find             10000           -
 *  -e          Ephemeral mode (don't write)            -               -
 *  -i          Stay idle and don't quit when done      -               -
 *  -n          Force a new download                    -               -
 *  -s PORT?    Enable live streaming on port N         8888            -
 *  -t          Disable trackers                        -               -
 *  -w          Wait for client before downloading      -               (impl -e)
 *
 *  -S PORT?    Local streaming mode on port N          8888            -
 *              * No downloading at all. The argument is the path to local files.
 *              * Excludes every other options.
 */

if(argv.w && !argv.s) {
    console.error("-w option requires -s");
    return;
}

if(argv.S) {
    // File stream mode
    var local_path;
    if(!(local_path = argv._[0])) {
        local_path = argv.S;
        argv.S = 8888;
    }

    if(!fs.existsSync(local_path)) {
        console.log("Usage: tget -S [port] <path>");
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

    torrentize(local_path);

    console.log("Available files:");
    files.forEach(function(file, i) {
        console.log("  [" + (i+1) + "] " + file.name);
    });

    StreamServer.init(argv.S, files);
    console.log("\nLocal streaming enabled on port " + StreamServer.port + " (default file is " + StreamServer.def_idx + ")");
} else {
    // Torrent download mode
    TorrentEngine.load(argv._[0], argv, function(torrent) {
        if(!torrent) {
            console.log("Usage: tget <path|url|magnet> [options]");
            return;
        }

        TorrentEngine.init(torrent);

        // Exit safety check
        function exit(clean) {
            if(clean && (!TorrentEngine.done || StreamServer.open_streams > 0 || argv.i)) return;
            TorrentEngine.exit(clean || argv.e, function() {
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
            exit(false);
        });

        rl.setPrompt("");
        rl.write("Initializing torrent engine...");

        TorrentEngine.on("ready", function() {
            rl.write(" Ready.\n\n");

            rl.write("Downloading files:\n");
            TorrentEngine.files.forEach(function(file, i) {
                rl.write("  [" + (i+1) + "] " + file.path + "\n");
            });

            rl.write("\n");

            function print_progress() {
                var buf = [];

                var percent = TorrentEngine.downloadPercent();
                buf.push(utils.pad(percent, 3) + "%");
                buf.push(" ");

                var twens_percent = Math.floor(percent*2.5/10);
                buf.push("[");
                buf.push("==============================".slice(0, twens_percent));
                buf.push(twens_percent ? ">" : " ");
                buf.push("                              ".slice(0, 25-twens_percent));
                buf.push("]");
                buf.push("  ");

                buf.push(utils.bytes(TorrentEngine.downloadedBytes()));
                buf.push("  ");

                buf.push(utils.bytes(TorrentEngine.downloadSpeed()));
                buf.push("/s");
                buf.push("  ");

                function active(wire) {
                    return !wire.peerChoking;
                };

                buf.push(TorrentEngine.wires.filter(active).length);
                buf.push("/");
                buf.push(TorrentEngine.wires.length);
                buf.push(" peers");
                buf.push("  ");

                if(StreamServer.enabled) {
                    buf.push(StreamServer.open_streams);
                    buf.push(" streams");
                }

                rl.write(buf.join(""));
            }

            function clear_line() {
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

            setInterval(update_gui, 1000);

            TorrentEngine.on("done", function() {
                update_gui(true);
                exit(true);
            });

            if(argv.s) {
                StreamServer.init(argv.s, TorrentEngine.files);

                rl.write("Streaming enabled on port " + StreamServer.port);
                rl.write(" (default file is " + StreamServer.def_idx + ")\n\n");

                StreamServer.on("stream-close", function() {
                    exit(true);
                });
            }

            update_gui();
        });
    });
}
