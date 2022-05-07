import {PmsServerRequest, PmsServerResponse} from "./server";
import nodeFetch, {RequestInit} from "node-fetch";
import {MayBePromise} from "./types";
import http from "http";

export type PmsServerCallbackHandler = (request: PmsServerRequest, response: PmsServerResponse) => MayBePromise<void>;

export abstract class PmsServerHandler {
    abstract handle(request: PmsServerRequest, response: PmsServerResponse): MayBePromise<void>;
}

export class PmsServerPassThroughHandler extends PmsServerHandler {
    callbackInjectBuffer: (req: PmsServerRequest, buffer: Buffer) => MayBePromise<{
        data: Buffer | string,
        headers?: http.IncomingHttpHeaders
    }>;

    constructor(
        private compress: boolean = true,
    ) {
        super();
    }

    injectBuffer(callback: Required<PmsServerPassThroughHandler>['callbackInjectBuffer']) {
        this.callbackInjectBuffer = callback;
    }

    async handle(req: PmsServerRequest, res: PmsServerResponse) {
        const init: RequestInit = {
            compress: this.compress,
            headers: <any>req.headers,
            method: req.method,
            body: req.method === 'GET' || req.method === 'HEAD' ? null : req
        }
        const forwardResponse = await nodeFetch(req.url, init)
            .catch(e => {
                res.status(500).end();
                return null
            });
        if (!forwardResponse) {
            return
        }

        let forwardResponseHeaders = forwardResponse.headers.raw();
        if (this.compress) {
            delete forwardResponseHeaders['content-encoding'];
        }

        if (this.callbackInjectBuffer) {
            const buffer = await forwardResponse.buffer();
            const result = await this.callbackInjectBuffer(req, buffer);
            if (result.headers) {
                forwardResponseHeaders = Object.assign(forwardResponseHeaders, result.headers);
            }

            let data = result.data;
            if (!(data instanceof Buffer)) {
                data = Buffer.from(data);
            }
            forwardResponseHeaders['content-length'] = data.length;
            res.writeHead(forwardResponse.status, forwardResponseHeaders);
            res.write(data);
            res.end()
        } else {
            res.writeHead(forwardResponse.status, forwardResponseHeaders);
            forwardResponse.body.pipe(res);
        }
    }
}