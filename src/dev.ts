
import request from 'request';
import path from "path";
import fs from "fs";
import {createAppHttpHandler, PPPassThroughHttpHandler} from "./handler/http-handler";
import {PPServerProxy} from "./server/server";
import {PPPassThroughWsHandler} from "./handler/ws-handler";

const s = new PPServerProxy({
    https: {
        certPath: path.join(__dirname, '../certs/rootCA.pem'),
        keyPath: path.join(__dirname, '../certs/rootCA.key')
    }
});
s.listen(1234).then(r => {
    const h = new PPPassThroughHttpHandler(true, true);
    h.injectBuffer((h, b) => {
        const p = /function[\s]+removeJwp\(\)[\s]?\{/gmi;
        const p2 = /devtoolsDetector\[_0x2b36\[11\]\]\(\)/gmi;
        const p3 =/debugger/gmi;
        const out = b.toString()
            .replace(p, "function removeJwp() { return;")
            .replace(p2, "false")
            .replace(p3, "cc")
        return {
            data: out+";cc=1;"
        }
    })
    s.addRule().url(/playhydrax\.min\.js/).then(h)
    // s.addRule()
    //     .any()
    //     .then(async (request, response) => {
    //         console.log(request.method, request.url);
    //
    //         const passThrough = new PPPassThroughHttpHandler();
    //         passThrough.injectBuffer((request, buffer) => {
    //             console.log('--> response buffer size', buffer.length);
    //             return { data: buffer };
    //         })
    //
    //         await passThrough.handle(request, response);
    //     })
    //
    //
    // const pass = new PPPassThroughHttpHandler();
    // pass.injectBuffer((req, buffer) => {
    //     return {
    //         data: buffer.toString() + "<script>alert(1)</script>"
    //     };
    // })
    //
    // s.addRule()
    //     .host([/test-google\.com/g])
    //     .then(pass);
    //
    // const app = createAppHttpHandler();
    // app.get('/abc', (req, res) => {
    //     res.status(200).send('oke');
    // })
    // s.addRule().host('test-fake.com').then(app);
    //
    // s.getWebsocket()
    //     .addRule()
    //     .url(/\/websocket-pms\/success/gmi)
    //     .then((req, res) => {
    //         console.log('oke')
    //     });
    //
    // request('https://google.com/test?a=', {
    //     proxy: 'http://localhost:1234',
    //     ca: fs.readFileSync(path.join(__dirname, '../certs/rootCA.pem'))
    // }, (err, res) => {
    //     if (!!err) {
    //         console.log(err.name);
    //         return;
    //     }
    //     console.log(res.body.length);
    // })
});