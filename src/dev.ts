
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
    const pass = new PPPassThroughHttpHandler();
    pass.injectBuffer((req, buffer) => {
        return {
            data: buffer.toString() + "<script>alert(1)</script>"
        };
    })

    s.addRule()
        .host([/test-google\.com/g])
        .then(pass);

    const app = createAppHttpHandler();
    app.get('/abc', (req, res) => {
        res.status(200).send('oke');
    })
    s.addRule().host('test-fake.com').then(app);

    const inject = new PPPassThroughWsHandler();
    inject.injectSend(data => data.toString() + ' inject!');
    inject.injectReceive(data => data.toString() + ' inject!');

    const ws = s.getWebsocket();
    ws.addRule().host('abc.com').then(inject)

    request('https://google.com/test?a=', {
        proxy: 'http://localhost:1234',
        ca: fs.readFileSync(path.join(__dirname, '../certs/rootCA.pem'))
    }, (err, res) => {
        if (!!err) {
            console.log(err.name);
            return;
        }
        console.log(res.body.length);
    })
});