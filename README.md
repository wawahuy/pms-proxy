# PMS Proxy
[![Available on NPM](https://img.shields.io/npm/v/pms-proxy.svg)](https://npmjs.com/package/pms-proxy)  [![Try Mockttp on RunKit](https://badge.runkitcdn.com/pms-proxy.svg)](https://npm.runkit.com/pms-proxy)
<br>
Supports http/https traffic monitoring.

## Get Started
```bash
npm install pms-proxy
```


## Todo
- Fix Websocket
- Write unit test
- Setup CI
- 

## Progress
- Support http2
-

## Document
### Require
- Javascript
```javascript
const {PPServerProxy} = require('pms-proxy');
```
- Typescript
```javascript
import PPServerProxy from "pms-proxy";
```

### Create server

```javascript
    const server = new PPServerProxy()
    server.listen(1234).then(() => {
        console('created!');
    })
```

### Websocket Forward
```javascript
    const forwardDst = 'wss://socketsbay.com/wss/v2/2/demo/';
    server.getWebsocket()
        .addRule()
        .host('abc.com')
        .then(new PPPassThroughWsHandler(forwardDst))
    server.getWebsocket()
        .addRule()
        .url(/wss:\/\/hello\.com/)
        .then(new PPPassThroughWsHandler(forwardDst))
```

### Monitor all traffics http & https
Note: https only capture when provide CA cert, and install CA cert in machine
```javascript
    server.addRule()
        .any()
        .then(async (request, response) => {
            console.log(request.method, request.url);

            const passThrough = new PPPassThroughHttpHandler();
            passThrough.injectBuffer((request, buffer) => {
                console.log('--> response buffer size', buffer.length);
                return { data: buffer };
            })

            await passThrough.handle(request, response);
        })
```

### Inject page 'abc.com'

```javascript
    const pass = new PPPassThroughHttpHandler();
    pass.injectBuffer((req, buffer) => {
        return {
            data: buffer.toString() + "<script>alert('hello world!')</script>"
        };
    })

    server.addRule()
        .host(/abc\.com/g)
        // or .host("abc.com")
        // or .host((host) => host === "abc.com")
        .then(pass);
```

### Handle any request
```javascript
    server.addRule()
        .any()
        .then((req, res) => {
            res.status(200).write('Hello world!');
        })
```

### Create fake website
```javascript
    /// app as express
    const app = createAppHttpHandler();
    app.get('/', (req, res) => {
        res.status(200).send('oke');
    })
    server.addRule().host('test-fake.com').then(app);
```

### Create fake websocket 'abc.com'
```javascript
    const ws = server.getWebsocket();
    ws.addRule()
        .host('abc.com')
        .then((req, ws) => {
            ws.send('oke ws');
        })
```

### Inject websocket 'abc.com'
```javascript
    const inject = new PPPassThroughWsHandler();
    inject.injectSend(data => data.toString() + ' inject!');
    inject.injectReceive(data => data.toString() + ' inject!');

    const ws = server.getWebsocket();
    ws.addRule().host('abc.com').then(inject)
```

### Support monitor https traffic

```javascript
    const server = new PPServerProxy({
    https: {
        certPath: path.join(__dirname, '../certs/rootCA.pem'),
        keyPath: path.join(__dirname, '../certs/rootCA.key')
    }
});
```

- create CA cert:
```shell
openssl genrsa -out rootCA.key 2048
openssl req -x509 -new -nodes -key rootCA.key -sha256 -days 1825 -out rootCA.pem
openssl pkcs12 -export -out rootCA.p12 -inkey rootCA.key -in rootCA.pem
```