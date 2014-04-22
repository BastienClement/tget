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

StreamServer.init = function(port, files) {
    if(StreamServer.enabled) return;
    StreamServer.enabled = true;

    // Default port number
    StreamServer.port = (typeof port != "number" || port < 0 || port > 65535) ? 8888 : port;

    // Find the default file
    StreamServer.def_file = files.reduce(function(a, b) {
        return a.length > b.length ? a : b;
    });

    // Default file's index
    StreamServer.def_idx = files.indexOf(StreamServer.def_file) + 1;

    // Create HTTP server
    var server = http.createServer();
    server.on("request", function(request, response) {
        var u = url.parse(request.url);

        if(u.pathname === "/favicon.ico") return response.end();
        if(u.pathname === "/") u.pathname = "/" + StreamServer.def_idx;

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

    // Bind
    server.listen(StreamServer.port);
};

module.exports = StreamServer;
