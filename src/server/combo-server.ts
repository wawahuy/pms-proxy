import net from 'net';
import http, {IncomingMessage, ServerResponse} from "http";
import http2 from "http2";
import * as tls from "tls";
import * as https from "https";
import EventEmitter from "events";

/**
 * refer
 * https://github.com/httptoolkit/httpolyglot/blob/master/src/index.ts
 *
 */
export class PPComboServer extends net.Server {
    private readonly httpServer: http.Server;
    private readonly http2Server: http2.Http2Server;
    private readonly tlsServer: tls.Server;

    private readonly TLS_HANDSHAKE_BYTE = 0x16;
    private readonly HTTP2_PREFACE_BUFFER = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');

    constructor(
        requestListener: (req: IncomingMessage | http2.Http2ServerRequest, res: ServerResponse | http2.Http2ServerResponse) => void,
        tlsOptions?: https.ServerOptions
    ) {
        super(socket => this.connectionListener(socket));

        this.httpServer = new http.Server(requestListener);
        this.http2Server = http2.createServer(requestListener);
        if (tlsOptions) {
            this.tlsServer = new tls.Server(tlsOptions, tlsSocket => {
                if (tlsSocket.alpnProtocol === false || tlsSocket.alpnProtocol === 'http/1.1') {
                    this.httpServer.emit('connection', tlsSocket);
                } else {
                    this.http2Server.emit('connection', tlsSocket);
                }
            });
        } else {
            // Fake server that rejects all connections:
            this.tlsServer = <any>new EventEmitter();
            this.tlsServer.on('connection', (socket) => socket.destroy());
        }

        const servers = [
            this.httpServer,
            this.http2Server,
            this.tlsServer
        ];
        this.on('newListener', (eventName, listener) => {
            servers.forEach((server) => {
                server.addListener(eventName, listener);
            })
        });
        this.on('removeListener', (eventName, listener) => {
            servers.forEach((server) => {
                server.removeListener(eventName, listener);
            })
        });
    }

    private connectionListener(socket: net.Socket) {
        socket.once('readable', () => {
            this.handleSocket(socket);
        })
    }

    private handleSocket(socket: net.Socket) {
        const data = socket.read(1);
        if (!data) {
            console.error('combo-server cant read data');
            socket.destroy();
            return;
        }

        const firstByte = data[0];
        socket.unshift(data);

        if (firstByte === this.TLS_HANDSHAKE_BYTE) {
            // TLS sockets don't allow half open
            socket.allowHalfOpen = false;
            this.tlsServer.emit('connection', socket);
        } else if (firstByte === this.HTTP2_PREFACE_BUFFER[0]) {
            // The connection _might_ be HTTP/2. To confirm, we need to keep
            // reading until we get the whole stream:
            this.http2Listener(socket);
        } else {
            // The above unshift isn't always sufficient to invisibly replace the
            // read data. The rawPacket property on errors in the clientError event
            // for plain HTTP servers loses this data - this prop makes it available.
            // A bit of a hacky fix, but sufficient to allow for manual workarounds.
            (<any>socket).__httpPeekedData = data;
            this.httpServer.emit('connection', socket);
        }
    }

    private http2Listener(socket: net.Socket, pastData?: Buffer) {
        const h1Server = this.httpServer;
        const h2Server = this.http2Server;

        const newData: Buffer = socket.read() || Buffer.from([]);
        const data = pastData ? Buffer.concat([pastData, newData]) : newData;

        if (data.length >= this.HTTP2_PREFACE_BUFFER.length) {
            socket.unshift(data);
            if (data.slice(0, this.HTTP2_PREFACE_BUFFER.length).equals(this.HTTP2_PREFACE_BUFFER)) {
                // We have a full match for the preface - it's definitely HTTP/2.
                // For HTTP/2 we hit issues when passing non-socket streams (like H2 streams for proxying H2-over-H2).
                const socketWithInternals = socket as { _handle?: { isStreamBase?: boolean } };
                if (socketWithInternals._handle) {
                    socketWithInternals._handle.isStreamBase = false;
                }

                h2Server.emit('connection', socket);
                return;
            } else {
                h1Server.emit('connection', socket);
                return;
            }
        } else if (!data.equals(this.HTTP2_PREFACE_BUFFER.slice(0, data.length))) {
            socket.unshift(data);
            // Haven't finished the preface length, but something doesn't match already
            h1Server.emit('connection', socket);
            return;
        }

        // Not enough data to know either way - try again, waiting for more:
        socket.removeListener('error', () => {});
        socket.on('error', () => {});
        socket.once('readable', () => {
            this.http2Listener(socket, data);
        });
    }
}