import {IncomingMessage, ServerResponse} from "http";
import {PPComboServer} from "./combo-server";
import http2 from "http2";
import http from "http";
import {PPCa, PPCaOptions} from "../ca";
import * as https from "https";
import * as tls from "tls";
import net from "net";
import express from "express";
import * as Buffer from "buffer";
import {PPPassThroughHttpHandler} from "../handler/http-handler";
import {PPWebsocketProxy} from "./ws";
import {PPHttpRule} from "../rule/http-rule";

// import streams from "stream";
// type SocketIsh<MinProps extends keyof net.Socket> = streams.Duplex & Partial<Pick<net.Socket, MinProps>>;

export interface PPServerOptions {
    https?: PPCaOptions | undefined,
    // version current not support http2
    // http2?: true | false | 'fallback'
}


export type PPServerResponse = express.Response;

export class PPServerProxy {
    private server: PPComboServer;
    private app: express.Express;
    private ws: PPWebsocketProxy;

    private readonly rules: PPHttpRule[];

    constructor(
        private options?: PPServerOptions
    ) {
        this.init();
        this.rules = [];
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

    stop() {
        this.server.close();
    }

    addRule(rule?: PPHttpRule) {
        if (!rule) {
            rule = new PPHttpRule()
        }
        this.rules.push(rule);
        return rule;
    }

    private init() {
        let options: https.ServerOptions;
        if (this.options && this.options.https) {
            const ca = new PPCa(this.options.https);
            const certLocal = ca.generateCertificate('localhost');
            options = {
                cert: certLocal.cert,
                key: certLocal.key,
                ca: [certLocal.ca],
                // version current not support http2
                // ALPNProtocols: this.options.http2 === true
                //     ? ['h2', 'http/1.1']
                //     : this.options.http2 === 'fallback'
                //         ? ['http/1.1', 'h2']
                //         // false
                //         : ['http/1.1'],
                ALPNProtocols: ['http/1.1'],
                SNICallback: (domain: string, cb: Function) => {
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


        this.server = new PPComboServer(this.handleNativeRequest.bind(this), options);
        this.server.on('connection', this.handleConnection.bind(this));
        this.server.on('secureConnection', this.handleSecureConnection.bind(this));
        this.server.addListener('connect', this.handleConnect.bind(this));

        this.ws = new PPWebsocketProxy();
        this.server.on('upgrade', this.ws.handleUpgrade.bind(this.ws));

        this.app = express();
        this.app.use(express.json());
        this.app.use(this.handleExpressRequest.bind(this));
    }

    private handleNativeRequest(req: IncomingMessage | http2.Http2ServerRequest, res: ServerResponse | http2.Http2ServerResponse) {
        this.app(req as IncomingMessage, res as ServerResponse);
    }

    private async handleExpressRequest(req: express.Request, res: express.Response) {
        let url = req.url;
        if (!url.match(/^http(s?):\/\//g)) {
            url = `${req.protocol}://${req.hostname}${req.url}`;
        }

        // Rewrite url
        req.url = url;

        // Check rules
        for (let rule of this.rules) {
            if (await rule.test(req)) {
                // async
                return rule.handle(req, res);
            }
        }

        // Forward traffic
        const pass = new PPPassThroughHttpHandler(false);
        await pass.handle(req, res);
    }

    private handleConnection(socket: net.Socket) {
    }

    private handleSecureConnection(socket: tls.TLSSocket) {
    }

    private handleConnect(
        req: http.IncomingMessage | http2.Http2ServerRequest,
        resOrSocket: net.Socket | http2.Http2ServerResponse,
        upgradeHead: Buffer
    ) {
        if (resOrSocket instanceof net.Socket) {
            if (this.options && this.options.https) {
                // upgrade tls request
                this.handleH1Connect(req as http.IncomingMessage, resOrSocket);
            } else {
                // when no CA certificate
                // pass tcp tls data
                this.handlePassThroughTLS(req as http.IncomingMessage, resOrSocket, upgradeHead);
            }
        } else {
            // this.handleH2Connect(req as http2.Http2ServerRequest, resOrSocket);
            console.error('Can\'t support HTTP2');
        }
    }

    private handlePassThroughTLS(
        req: http.IncomingMessage,
        socket: net.Socket,
        upgradeHead: Buffer
    ) {
        const uSplit = req.url.split(':');
        const port = Number(uSplit?.[1]) || 443;
        const domain = uSplit[0];

        const proxySocket = new net.Socket();
        proxySocket.connect(port, domain, () => {
                proxySocket.write(upgradeHead);
                socket.write("HTTP/" + req.httpVersion + " 200 Connection established\r\n\r\n");
            }
        );

        proxySocket.on('data', (chunk) => {
            socket.write(chunk);
        });

        proxySocket.on('end', () => {
            socket.end();
        });

        proxySocket.on('error', () => {
            socket.write("HTTP/" + req.httpVersion + " 500 Connection error\r\n\r\n");
            socket.end();
        });

        socket.on('data', (chunk) => {
            proxySocket.write(chunk);
        });

        socket.on('end', () => {
            proxySocket.end();
        });

        socket.on('error', () => {
            proxySocket.end();
        });
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
            this.server.emit('connection', socket);
        });
    }

    // private handleH2Connect(req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) {
    //     const connectUrl = req.headers[':authority'];
    //
    //     if (!connectUrl) {
    //          // If we can't work out where to go, send an error.
    //          res.writeHead(400, {});
    //          res.end();
    //          return;
    //     }
    //     // Send a 200 OK response, and start the tunnel:
    //     res.writeHead(200, {});
    //     this.copyAddressDetails(res.socket, res.stream);
    //
    //     // When layering HTTP/2 on JS streams, we have to make sure the JS stream won't autoclose
    //     // when the other side does, because the upper HTTP/2 layers want to handle shutdown, so
    //     // they end up trying to write a GOAWAY at the same time as the lower stream shuts down,
    //     // and we get assertion errors in Node v16.7+.
    //     if (res.socket.constructor.name.includes('JSStreamSocket')) {
    //         res.socket.allowHalfOpen = true;
    //     }
    //
    //     this.server.emit('connection', res.stream);
    // }

    // private copyAddressDetails(
    //     source: SocketIsh<'localAddress' | 'localPort' | 'remoteAddress' | 'remotePort'>,
    //     target: SocketIsh<'localAddress' | 'localPort' | 'remoteAddress' | 'remotePort'>
    // ) {
    //     const fields = ['localAddress', 'localPort', 'remoteAddress', 'remotePort'] as const;
    //     Object.defineProperties(target, fields.reduce((data, item) => {
    //         data[item] = { writable: true };
    //         return data;
    //     }, {}));
    //     fields.forEach((fieldName) => {
    //         if (target[fieldName] === undefined) {
    //             (target as any)[fieldName] = source[fieldName];
    //         }
    //     });
    // }

}