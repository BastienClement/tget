/*
    Copyright (c) 2014 Bastien Clément <g@ledric.me>

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

    Includes portion of code from <https://github.com/mafintosh/peerflix>
    Copyright (C) 2013 Mathias Buus Madsen <mathiasbuus@gmail.com>
*/

var url = require("url");
var http = require("http");
var mime = require("mime");
var rangeParser = require("range-parser");
var pump = require("pump");
var events = require("events");

var StreamServer = new events.EventEmitter();

StreamServer.enabled = false;
StreamServer.open_streams = 0;

var media_extensions = [
    "3gp",
    "asf",
    "wmv",
    "au",
    "avi",
    "flv",
    "mov",
    "mp4",
    "ogm",
    "ogg",
    "mkv",
    "mka",
    "ts",
    "mpg",
    "mp3",
    "mp2",
    "nsc",
    "nut",
    "ra",
    "ram",
    "rm",
    "rv",
    "rmbv",
    "a52",
    "dts",
    "aac",
    "flac",
    "dv",
    "vid",
    "tta",
    "tac",
    "ty",
    "wav",
    "dts",
    "xa"
];

StreamServer.init = function(port, files) {
    if(StreamServer.enabled) return;
    StreamServer.enabled = true;

    // Default port number
    StreamServer.port = (typeof port != "number" || port < 0 || port > 65535) ? 8888 : port;

    // Media files in this torrent
    var media_files = files.map(function(f, i) {
        var offset;
        return {
            name: f.path,
            id:   i + 1,
            ext:  (offset = f.path.lastIndexOf(".")) >= 0 && f.path.slice(offset + 1)
        };
    }).filter(function(f) {
        // Try to match a predefined extension
        if(f.ext && (media_extensions.indexOf(f.ext) !== -1)) {
            return true;
        }

        // Try to match from MIME type
        var mime_type = mime.lookup(f.name).split("/")[0];
        if(mime_type === "audio" || mime_type === "video") {
            return true;
        }

        return false;
    });

    // Find the default file
    StreamServer.def_file = files.reduce(function(a, b) {
        return a.length > b.length ? a : b;
    });

    // Default file's index
    StreamServer.def_idx = files.indexOf(StreamServer.def_file) + 1;

    // Use m3u playlist as default
    StreamServer.use_m3u = media_files.length > 1;

    // Create HTTP server
    var server = http.createServer();
    server.on("request", function(request, response) {
        var u = url.parse(request.url);

        if(u.pathname === "/favicon.ico") return response.end();

        if(u.pathname === "/") {
            if(StreamServer.use_m3u) {
                var host = request.headers.host || "localhost";
                response.setHeader("Content-Type", "application/x-mpegurl; charset=utf-8");
                return response.end("#EXTM3U\n" + media_files.map(function(f) {
                    return "#EXTINF:-1," + f.name + "\n" + "http://" + host + "/" + f.id + "." + f.ext;
                }).join("\n"));
            } else {
                u.pathname = "/" + StreamServer.def_idx;
            }
        }

        // Allow random file extensions to be given (http://127.0.0.1:8888/2.srt)
        var i = Number(u.pathname.slice(1).split(".")[0]) - 1;

        if(isNaN(i) || i >= files.length || i < 0) {
            response.statusCode = 404;
            response.end();
            return;
        }

        var file = files[i];
        var range = request.headers.range;
        range = range && rangeParser(file.length, range)[0];

        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Content-Type", mime.lookup(file.name));

        ++StreamServer.open_streams;
        StreamServer.emit("stream-open");

        var done_once = false;
        function stream_done() {
            if(done_once) return;
            done_once = true;
            --StreamServer.open_streams;
            StreamServer.emit("stream-close");
        }

        response.on("close", stream_done);
        response.on("finish", stream_done);

        if(!range) {
            response.setHeader("Content-Length", file.length);
            if(request.method === "HEAD") return response.end();
            pump(file.createReadStream(), response);
            return;
        }

        response.statusCode = 206;
        response.setHeader("Content-Length", range.end - range.start + 1);
        response.setHeader("Content-Range", "bytes " + range.start + "-" + range.end + "/" + file.length);

        if(request.method === "HEAD") return response.end();
        pump(file.createReadStream(range), response);
    });

    // Prevent timeout on paused streams
    server.on("connection", function(socket) {
        socket.setTimeout(36000000);
    });

    // Bind
    server.listen(StreamServer.port);
};

module.exports = StreamServer;
