var AWS = require('aws-sdk');
var path = require("path");
var fs = require('fs');
var process = require('process');

var credentials = {
    accessKeyId: 'AKIASLJLX3PW7QJ4F5OU',
    secretAccessKey: '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'
}
var REGION = "us-east-1";
const request_queue_url = 'https://sqs.us-east-1.amazonaws.com/161689885677/RequestQueue';
const response_queue_url = 'https://sqs.us-east-1.amazonaws.com/161689885677/ResponseQueue';

const { spawn } = require('child_process');
const { time } = require('console');
const execSync = require('child_process').execSync;

const s3 = new AWS.S3({ credentials: credentials, region: REGION });
const sqs = new AWS.SQS({ credentials: credentials, region: REGION });
const ec2 = new AWS.EC2({ credentials: credentials, region: REGION });

//This is master instance server!

var idealTimeout = 120000;
var params_queue_request = {
    QueueUrl: request_queue_url,
    MaxNumberOfMessages: 1,
    VisibilityTimeout: 10,
};

var params_queue_response = {
    QueueUrl: response_queue_url,
    DelaySeconds: 0,
    MessageBody: null
}

//Initially creating some required folders. 
input_images_folder = "input_images";
// output_images_folder = "output_images";

if (!fs.existsSync(input_images_folder)) {
    fs.mkdirSync(input_images_folder);
    console.log("Created folder : ", input_images_folder);
}

//Storing images in temp arrays only, will change if needed.

//Array to store all input images. Not sure if they are required!
request_queue = [];
response_queue = [];

// var curr_instance_id;
//Get the instance id of this instance,
var meta = new AWS.MetadataService();

var curr_instance_id = 0;
instance_ids = []
var params_terminate = { InstanceIds: [], DryRun: true };

meta.request("/latest/meta-data/instance-id", function(err, data) {
    curr_instance_id = data.toString();
    console.log("Current instance id is set to:", curr_instance_id);
    instance_ids.push(curr_instance_id)
    params_terminate.InstanceIds = instance_ids;

});

// function terminate(params_terminate) {
//     ec2.terminateInstances(params_terminate, function(err, data) {
//         if (err && err.code === 'DryRunOperation') {
//             params_terminate.DryRun = false;
//             ec2.stopInstances(params_terminate, function(err, data) {
//                 if (err) {
//                     console.log("Error", err);
//                 } else if (data) {
//                     console.log("Success in terminated current instance", data.StoppingInstances);
//                 }
//             });
//         } else {
//             console.log("You don't have permission to stop instances");
//         }
//     });
// }

function stop(params_terminate) {

    ec2.stopInstances(params_terminate, function(err, data) {
        console.log(params_terminate)
        console.log(err)
        if (err && err.code === 'DryRunOperation') {
            params_terminate.DryRun = false;
            ec2.stopInstances(params_terminate, function(err, data) {
                if (err) {
                    console.log("Error", err);
                } else if (data) {
                    console.log("Success stoping ", data.StoppingInstances);
                }
            });
        } else {
            console.log("You don't have permission to stop instances");
        }
    });

}

var currTimeout = setTimeout(stop, idealTimeout, params_terminate);
var p_list = []

function receiveMessagesWrapper() {
    //make this function over a loop to continuously collect request 
    sqs.receiveMessage(params_queue_request, (err, data) => {
        if (err) console.log(err, err.stack); // an error occurred
        else {
            if (data.Messages) {
                for (var i = 0; i < data.Messages.length; i++) {
                    //reset old timeout
                    clearTimeout(currTimeout);
                    currTimeout = setTimeout(stop, idealTimeout, params_terminate);

                    var obj = JSON.parse(data.Messages[i].Body)
                    file_name = obj.fileName;
                    console.log("Received " + obj.fileName + " Will delete it!");

                    //Decode the image first
                    const file_string = obj.file;
                    const file_buff = file_string.split(",")[1];
                    path_to_image = process.cwd() + '/input_images/' + file_name;

                    //saving the file in input folder.
                    fs.writeFileSync(path_to_image, file_buff, { encoding: 'base64' });
                    var curr_file = fs.readFileSync(path_to_image);

                    //Storing curr file to input bucket
                    var uploadParamsForInput = { Bucket: 'cloudcomputinginputs', Key: obj.fileName, Body: curr_file };

                    // call S3 to retrieve upload file to specified bucket
                    s3.upload(uploadParamsForInput, function(err, data) {
                        if (err) {
                            console.log("Error in uploading file, filename: " + obj.fileName, err);
                        }
                        if (data) {
                            console.log("Upload Success INPUT", data.Location);
                        }
                    });

                    // process.chdir('');
                    const model = spawn('python3', ['face_recognition.py', path_to_image]);
                    // process.chdir('app-tier/');

                    model.stdout.on('data', (data) => {
                        console.log('Recieved output for ' + obj.fileName + " is " + data);

                        var uploadParamsForOutput = { Bucket: 'cloudcomputingoutputs', Key: obj.fileName.toString().replace('.jpg', ''), Body: data.toString() };

                        s3.upload(uploadParamsForOutput, function(err, data) {
                            if (err) {
                                console.log("Error in uploading file, filename: " + obj.fileName, err);
                            }
                            if (data) {
                                console.log("Upload Success OUTPUT", data.Location);
                            }
                        })

                        var body = {
                            fileName: obj.fileName.toString(),
                            file: data.toString()
                        }
                        params_queue_response.MessageBody = JSON.stringify(body);

                        sqs.sendMessage(params_queue_response, (err, data) => {
                            if (err) {
                                console.log("Error in sending data to response queue");
                            } else {
                                console.log("Data successfully sent to response queue for: ", data.toString());
                            }
                        });

                    });

                    model.stderr.on('data', (err) => {
                        console.log('Error: ' + err);
                        receiveMessagesWrapper()
                    });
                    var params_queue_delete = {
                        QueueUrl: request_queue_url,
                        ReceiptHandle: data.Messages[i].ReceiptHandle
                    };
                    model.on('close', (code) => {
                        console.log('child process is closed with code: ' + code);

                        try {
                            sqs.deleteMessage(params_queue_delete, function(err, data) {
                                err && console.log(err);
                            });
                        } catch (err) {}
                        receiveMessagesWrapper()
                    });
                }
            } else {
                receiveMessagesWrapper();
            }
        }

    });
}

receiveMessagesWrapper();
var child = spawn('pwd')
child.stdout.on('data', (data) => {
    console.log(`child stdout:\n${data}`);
});