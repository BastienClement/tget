tget
====

Command-line torrent downloader and HTTP streaming server

`npm install -g tget`

Based on the fantastic [torrent-stream](https://github.com/mafintosh/torrent-stream), by [mafintosh](https://github.com/mafintosh)

## Usage

`tget <path|url|magnet> [options]`

### Example

`tget "magnet:?xt=urn:btih:757fc565c56462b28b4f..." -s 9000`

### Options

|  Option      |  Description                          |  Default      |
|--------------|---------------------------------------|---------------|
|  `-c NUM`    |  Maximum connections                  |  100          |
|  `-d NUM`    |  Number of DHT peers to find          |  10000        |
|  `-e`        |  Ephemeral mode                       |               |
|  `-i`        |  Stay idle and don't quit when done   |               |
|  `-p PEER`   |  Explicit peer (in the form addr:ip)  |               |
|  `-q`        |  Quiet mode                           |               |
|  `-s [PORT]` |  Enable live streaming on port N      |  8888         |
|  `-t`        |  Disable trackers                     |               |
|  `-w`        |  Wait for stream before downloading   |               |

### Video streaming

When downloading a video torrent, tget can stream it to your favorite
media player as soon as its pieces are received.

Passing the `-s` option (with an optional port number) enables the
streaming feature.

Then, simply open `http://127.0.0.1:<port>/<file_id>` in your media player.

The default streaming port is `8888`. If you don't specify the target
file, tget automatically choose the biggest file in the torrent.

While stream data has higher priority than non-stream data (such as
.nfo or preview files), tget still download the entire torrent data
when bandwidth allows it. When the `-w` option is given, tget will wait
an incoming stream connection before dowloading any data from the torrent.

When the `-w` option is given, `-e` and `-i` are implicitely enabled.
This turns tget into a streaming-only downloader and no data will be
kept upon exit.

## Local streaming

The stream engine from tget can also be used for streaming local files.

When the `-S` option is given, tget will not attempt to download a
torrent but will instead use the given path as the stream data source.
This can be a single file as well as a directory.

`tget ./local.mp4 -S`

If the `-S` option is given, no other option will be used.
`-i` is implicitely enabled.

## License

MIT

Portion of streaming code taken from [Peerflix](https://github.com/mafintosh/peerflix)

Copyright (C) 2013 Mathias Buus Madsen <mathiasbuus@gmail.com>
