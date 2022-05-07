# PMS Proxy
Supports http/https traffic monitoring.

## Todo
- Support websocket forward and monitoring
- Write more rules and handlers
- Function create CA cert and generate SPKIFingerprint
-

## Progress
- Support http2
-

## Document

### Create server monitor http traffic
```javascript
    const server = new PmsServerProxy()
    server.listen(1234).then(() => {
        console('created!');
    })
```

### Inject page 'abc.com'
```javascript
    const pass = new PmsServerPassThroughHandler();
    pass.injectBuffer((req, buffer) => {
        return {
            data: buffer.toString() + "<script>alert('hello world!')</script>"
        };
    })
    
    server.addRule()
        .host([/abc\.com/g])
        .setHandler(pass);
```

### Handle any request
```javascript
    s.addRule()
        .match(() => true)
        .setHandler((req, res) => {
            res.status(200).write('Hello world!');
        })
```


### Support monitor https traffic
```javascript
    const server = new PmsServerProxy({
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