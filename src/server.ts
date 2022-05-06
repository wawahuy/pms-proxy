import {IncomingMessage, ServerResponse} from "http";
import {ComboServer} from "./combo-server";
import http2 from "http2";
import http from "http";
import {PmsCa, PmsCAOptions} from "./ca";
import * as https from "https";
import * as tls from "tls";
import net from "net";
import streams from "stream";
import nodeFetch from "node-fetch";

type SocketIsh<MinProps extends keyof net.Socket> = streams.Duplex & Partial<Pick<net.Socket, MinProps>>;

export interface PmsServerProxyOptions {
    https?: PmsCAOptions | undefined,
    http2?: true | false | 'fallback'
}

export class PmsServerProxy {
    server: ComboServer;

    constructor(
        private options?: PmsServerProxyOptions
    ) {
        this.init();
    }

    listen(port: number, host: string = '0.0.0.0') {
        return new Promise<boolean>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(port, host, () => {
                this.server.removeListener('error', reject);
                resolve(true)
            });
        })
    }

    private init() {
        let options: https.ServerOptions;
        if (this.options.https) {
            const ca = new PmsCa(this.options.https);
            const certLocal = ca.generateCertificate('localhost');
            options = {
                cert: certLocal.cert,
                key: certLocal.key,
                ca: [certLocal.ca],
                ALPNProtocols: this.options.http2 === true
                    ? ['h2', 'http/1.1']
                    : this.options.http2 === 'fallback'
                        ? ['http/1.1', 'h2']
                        // false
                        : ['http/1.1'],
                SNICallback: (domain: string, cb: Function) => {
                    console.log(domain)
                    try {
                        const generatedCert = ca.generateCertificate(domain);
                        cb(null, tls.createSecureContext({
                            key: generatedCert.key,
                            cert: generatedCert.cert,
                            ca: generatedCert.ca
                        }));
                    } catch (e) {
                        console.error('Cert generation error', e);
                        cb(e);
                    }
                }
            }
        }

        this.server = new ComboServer(this.handleRequest.bind(this), options);
        this.server.addListener('connect', this.handleConnect.bind(this));
    }

    private handleRequest(req: IncomingMessage | http2.Http2ServerRequest, res: ServerResponse | http2.Http2ServerResponse) {
        const host = 'https://' + req.headers['host'] + req.url;
        nodeFetch(host, { headers: <any>req.headers })
            .then(r => r.body)
            .then(r => r.pipe(res));
    }

    private handleConnect(
        req: http.IncomingMessage | http2.Http2ServerRequest,
        resOrSocket: net.Socket | http2.Http2ServerResponse
    ) {
        if (resOrSocket instanceof net.Socket) {
            this.handleH1Connect(req as http.IncomingMessage, resOrSocket);
        } else {
            this.handleH2Connect(req as http2.Http2ServerRequest, resOrSocket);
        }
    }

    private handleH1Connect(req: http.IncomingMessage, socket: net.Socket) {
        // Clients may disconnect at this point (for all sorts of reasons), but here
        // nothing else is listening, so we need to catch errors on the socket:
        socket.once('error', (e) => console.log('Error on client socket', e));

        const connectUrl = req.url || req.headers['host'];
        if (!connectUrl) {
            // If we can't work out where to go, send an error.
            socket.write('HTTP/' + req.httpVersion + ' 400 Bad Request\r\n\r\n', 'utf-8');
            return;
        }

        socket.write('HTTP/' + req.httpVersion + ' 200 OK\r\n\r\n', 'utf-8', () => {
            // socket.__timingInfo!.tunnelSetupTimestamp = now();
            this.server.emit('connection', socket);
        });
    }

    private handleH2Connect(req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) {
        const connectUrl = req.headers[':authority'];

        if (!connectUrl) {
             // If we can't work out where to go, send an error.
             res.writeHead(400, {});
             res.end();
             return;
        }
        // Send a 200 OK response, and start the tunnel:
        res.writeHead(200, {});
        this.copyAddressDetails(res.socket, res.stream);
        // copyTimingDetails(res.socket, res.stream);

        // When layering HTTP/2 on JS streams, we have to make sure the JS stream won't autoclose
        // when the other side does, because the upper HTTP/2 layers want to handle shutdown, so
        // they end up trying to write a GOAWAY at the same time as the lower stream shuts down,
        // and we get assertion errors in Node v16.7+.
        if (res.socket.constructor.name.includes('JSStreamSocket')) {
            res.socket.allowHalfOpen = true;
        }

        this.server.emit('connection', res.stream);
    }

    private copyAddressDetails(
        source: SocketIsh<'localAddress' | 'localPort' | 'remoteAddress' | 'remotePort'>,
        target: SocketIsh<'localAddress' | 'localPort' | 'remoteAddress' | 'remotePort'>
    ) {
        const fields = ['localAddress', 'localPort', 'remoteAddress', 'remotePort'] as const;
        Object.defineProperties(target, fields.reduce((data, item) => {
            data[item] = { writable: true };
            return data;
        }, {}));
        fields.forEach((fieldName) => {
            if (target[fieldName] === undefined) {
                (target as any)[fieldName] = source[fieldName];
            }
        });
    }

}