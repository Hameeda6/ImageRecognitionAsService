// we use express and multer libraries to send images
const express = require('express');
const multer = require('multer');
const cors = require('cors')
const app = express(cors());
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

var timeout = require('connect-timeout');
app.use(timeout(1000000));

function haltOnTimedout(req, res, next) {
    if (!req.timedout) next();
}
const AWS = require('aws-sdk');
const path = require("path");
const PORT = 3000;
const credentials = {
    accessKeyId: 'AKIASLJLX3PW7QJ4F5OU',
    secretAccessKey: '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'
}
const { spawn } = require('child_process');
const REGION = "us-east-1";
const BUCKET_NAME = "cloudcomputinginputs"
const request_queue_url = 'https://sqs.us-east-1.amazonaws.com/161689885677/RequestQueue';
const response_queue_url = 'https://sqs.us-east-1.amazonaws.com/161689885677/ResponseQueue';
const sessionID = 'e7a09730-88b5-2888-d3a0-e970f6160982';
// uploaded images are saved in the folder "/upload_images"
const upload = multer({ dest: __dirname + '/upload_images' });
// const s3 = new AWS.S3({ credentials: credentials, region: REGION });
const sqs = new AWS.SQS({ credentials: credentials, region: REGION })
app.use(express.static('public'));
app.use(express.json())
app.timeout = 1000000;
var request_list = []
const EventEmitter = require('stream');
const { response } = require('express');
const stream = new EventEmitter();
app.use(haltOnTimedout);

// "myfile" is the key of the http payload
app.post('/', upload.single('myfile'), function(request, respond) {
    //console.log(request)
    if (request.file) console.log(request.file);

    // save the image
    var fs = require('fs');
    fs.renameSync(__dirname + '/upload_images/' + request.file.filename, __dirname + '/upload_images/' + request.file.originalname, function(err) {
        if (err) console.log('ERROR: ' + err);
    });
    filePath = __dirname + '/upload_images/' + request.file.originalname
    let bucketPath = request.file.originalname;
    var body = {
        fileName: bucketPath,
        file: 'data:image/jpeg;base64,' + fs.readFileSync(filePath, { encoding: 'base64' }).toString()
    }

    var params_queue_send = {
        DelaySeconds: 0,
        MessageAttributes: {},
        MessageBody: JSON.stringify(body),
        QueueUrl: request_queue_url //SQS_QUEUE_URL; e.g., 'https://sqs.REGION.amazonaws.com/ACCOUNT-ID/QUEUE-NAME'
    };

    sqs.sendMessage(params_queue_send, function(err, data) {
        if (err) {
            // console.log("Error", err);
        } else {
            // console.log("Success", data.MessageId);
        }
    });
    stream.emit('push', 'message', { type: 'request', msg: JSON.stringify(body) });
    request_list[bucketPath] = respond;
});


function receiveMessages(request_list) {
    //Send classification inside.
    var params_queue_receive = {
        QueueUrl: response_queue_url,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 1,
        WaitTimeSeconds: 1,
    };
    sqs.receiveMessage(params_queue_receive, (err, data) => {
        //console.log(Object.keys(request_list).length, Object.keys(request_list));
        if (err) console.log(err, err.stack); // an error occurred
        else {
            if (data.Messages) {
                for (var i = 0; i < data.Messages.length; i++) {
                    var message = data.Messages[i];
                    try {
                        var obj = JSON.parse(data.Messages[i].Body)
                    } catch (err) {
                        stream.emit('push', 'message', { type: 'error', msg: err });
                    }
                    stream.emit('push', 'message', { type: 'result', msg: JSON.stringify(obj) });
                    if (obj.fileName in request_list) {
                        //Pending, delete the message from SQS Queue.
                        try {
                            var response = request_list[obj.fileName]
                        } catch (err) {
                            stream.emit('push', 'message', { type: 'error', msg: err });
                        }
                        response.end(obj.file);
                        delete request_list[obj.fileName]
                        var params_queue_delete = {
                            QueueUrl: response_queue_url,
                            ReceiptHandle: message.ReceiptHandle
                        };
                        sqs.deleteMessage(params_queue_delete, function(err, data) {
                            // err && console.log(err);
                        });
                    }
                    else{
                    	var params_queue_delete = {
                            QueueUrl: response_queue_url,
                            ReceiptHandle: message.ReceiptHandle
                        };
                        sqs.deleteMessage(params_queue_delete, function(err, data) {
                            // err && console.log(err);
                        });
                    }
                }
            }

        }
    })
}
setInterval(receiveMessages, 1500, request_list)

app.post('/script', (req, res) => {
    var dataToSend;
    var request = req.body
    const python = spawn('python3', ['./frontend-server/multithread_workload_generator.py', '--num_request', request.number, '--url', 'http://backend.vantinum.com', '--image_folder', './frontend-server/face_images_100/']);
    python.stdout.setEncoding('utf8');
    try {
        python.stdout.on('data', function(data) {
            console.log('stdout: ' + data);
            stream.emit('push', 'message', { type: 'python', msg: data });
            dataToSend += data.toString();
        });
        python.on('close', (code) => {
            // send data to browser
            try {
            stream.emit('push', 'message', { type: 'python', msg: dataToSend });
                res.send(JSON.stringify({ 'msg': dataToSend }))
            } catch (err) {
                stream.emit('push', 'message', { type: 'error', msg: err });
            }
        });
    } catch (err) { res.send(JSON.stringify({ 'msg': err })) }
})

app.get('/sse', function(request, response) {
    response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    stream.on('push', function(event, data) {
        response.write('event: ' + String(event) + '\n' + 'data: ' + JSON.stringify(data) + '\n\n');
    });
});

// You need to configure node.js to listen on 0.0.0.0 so it will be able to accept connections on all the IPs of your machine
const hostname = 'localhost';
app.listen(PORT, hostname, () => {
    console.log(`app running at http://${hostname}:${PORT}/`);
});

var child = spawn('pwd')
child.stdout.on('data', (data) => {
    console.log(`child stdout:\n${data}`);
});
