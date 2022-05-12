import {PPServerRequest, PPServerResponse} from "../server/server";
import nodeFetch, {RequestInit} from "node-fetch";
import {MayBePromise} from "../types";
import http from "http";
import express from "express";
import AbortControllerLib from "abort-controller";
const AbortController = globalThis.AbortController || AbortControllerLib;

export type PPCallbackHttpHandler = (request: PPServerRequest, response: PPServerResponse) => MayBePromise<void>;

export abstract class PPHttpHandler {
    abstract handle(request: PPServerRequest, response: PPServerResponse): MayBePromise<void>;
}

export const createAppHttpHandler = () => express();

export class PPPassThroughHttpHandler extends PPHttpHandler {
    callbackInjectBuffer: (req: PPServerRequest, buffer: Buffer) => MayBePromise<{
        data: Buffer | string,
        headers?: http.IncomingHttpHeaders
    }>;

    constructor(
        private compress: boolean = true
    ) {
        super();
    }

    injectBuffer(callback: Required<PPPassThroughHttpHandler>['callbackInjectBuffer']) {
        this.callbackInjectBuffer = callback;
    }

    async handle(req: PPServerRequest, res: PPServerResponse) {
        const abort = new AbortController();
        const init: RequestInit = {
            compress: this.compress,
            headers: <any>req.headers,
            method: req.method,
            body: req.method === 'GET' || req.method === 'HEAD'
                ? null
                : req.readableEnded ? req.body : req,
            redirect: "manual",
            signal: abort.signal
        }
        const forwardResponse = await nodeFetch(req.url, init)
            .catch(e => {
                console.log(e);
                res.status(500).end();
                return null
            });
        if (!forwardResponse) {
            return
        }

        forwardResponse.body.on("error", () => {
            res.status(500).end();
        })

        req.on('close', () => {
            if (!res.writableEnded) {
                abort.abort()
            }
        })

        let forwardResponseHeaders = forwardResponse.headers.raw();
        if (this.compress) {
            delete forwardResponseHeaders['content-encoding'];
        }

        if (this.callbackInjectBuffer) {
            const buffer = await forwardResponse.buffer()
                .catch(r => null);

            if (!buffer) {
                return;
            }

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