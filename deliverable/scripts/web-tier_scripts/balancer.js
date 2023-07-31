var AWS = require("aws-sdk");

var credentials = {
    accessKeyId: 'AKIASLJLX3PW7QJ4F5OU',
    secretAccessKey: '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'
}

var REGION = 'us-east-1'

var ec2 = new AWS.EC2({ credentials: credentials, region: REGION });
var sqs = new AWS.SQS({ credentials: credentials, region: REGION });

async function sleep(msec) {
    return new Promise(resolve => setTimeout(resolve, msec));
}

async function testSleep(time_in_milliseconds) {
    console.log("Waiting for ", time_in_milliseconds / 1000, " seconds...");
    await sleep(time_in_milliseconds);
    console.log("Waiting done."); // Called 1 second after the first console.log
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


function generateTag(tagIterator, return_list) {
    tagIterator = tagIterator + 1;
    let temp = "app-instance-";
    ec2_list_pending = return_list[3];
    ec2_list_stopped = return_list[1];
    ec2_list_stopping = return_list[2];
    ec2_list_running = return_list[0];
    ec2_list_total = return_list[4];
    while ((temp.concat(tagIterator.toString()) in ec2_list_pending) ||
        (temp.concat(tagIterator.toString()) in ec2_list_running) ||
        (temp.concat(tagIterator.toString()) in ec2_list_stopped) ||
        (temp.concat(tagIterator.toString()) in ec2_list_stopping)) {
        tagIterator = tagIterator + 1;
    }
    return tagIterator;
}

function findInstanceName(ins) {
    for (var j in ins.Tags) {
        if (ins.Tags[j].Key === 'Name' && ins.Tags[j].Value.includes('app-instance-')) {
            return ins.Tags[j].Value;
        }
    }
    return null;
}

ec2_list_total = {}
ec2_list_running = {}
ec2_list_stopped = {}
ec2_list_stopping = {}
ec2_list_pending = {}


async function createInstance(instanceParams, tagValue) {
    // Create a promise on an EC2 service object
    var instancePromise = new AWS.EC2({ credentials: credentials, region: REGION }).runInstances(instanceParams).promise();
    var instanceId = null;
    await instancePromise;
    // Handle promise's fulfilled/rejected states
    instancePromise.then(
        async function(data) {
            console.log(data);
            instanceId = data.Instances[0].InstanceId;
            console.log("Created instance", instanceId);
            // Add tags to the instance
            tagParams = {
                Resources: [instanceId],
                Tags: [{
                    Key: 'Name',
                    Value: tagValue
                }]
            };

            // Create a promise on an EC2 service object
            var tagPromise = new AWS.EC2({ credentials: credentials, region: REGION }).createTags(tagParams).promise();

            await tagPromise;
            // Handle promise's fulfilled/rejected states
            tagPromise.then(
                function(data) {
                    console.log("Instance tagged");

                    //successfully finished creating
                    return instanceId;
                }).catch(
                function(err) {
                    console.error(err, err.stack);
                    //terminate this instance.
                });
        }).catch(
        function(err) {
            console.error(err, err.stack);
        });
}

var thresholdTasks = 3;
var idleTime = 25; // seconds
var tagIterator = 0;
var previousTag = tagIterator;
var totalMessages = 0
var maxCountInstances = 19;
var params_for_request_queue = {
    QueueUrl: 'https://sqs.us-east-1.amazonaws.com/161689885677/RequestQueue',
    AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
};

async function wrapperGetQueueAtttributes() {
    console.log("------------------------------------------------------\n\n------------------------------------------------------\nNEW ITERATION")
        //flush old values
    ec2_list_total = {}
    ec2_list_running = {}
    ec2_list_stopped = {}
    ec2_list_pending = {}
    ec2_list_stopping = {}

    await sqs.getQueueAttributes(params_for_request_queue)
        .promise()
        .then((data, err) => {
            totalMessages = 0;
            if (err) { console.log(err, err.stack); } // an error occurred
            else {
                totalMessages = parseInt(data['Attributes']['ApproximateNumberOfMessages'])
                    // totalMessages = parseInt(data['Attributes']['ApproximateNumberOfMessages']) + parseInt(data['Attributes']['ApproximateNumberOfMessagesNotVisible']); // successful response
            }
            console.log("Total messages: ", totalMessages);
            var params_ec2 = {
                DryRun: false
            };
            var return_vars = { 'totalMessages': totalMessages, 'params_ec2': params_ec2 }
            return return_vars;
        }).then(async(return_vars) => {
            // console.log('ec2', return_vars)
            var params_ec2 = return_vars['params_ec2'];
            var data = await ec2.describeInstances(params_ec2).promise();
            ec2_list_total = {}
            ec2_list_running = {}
            ec2_list_stopped = {}
            ec2_list_pending = {}
            ec2_list_stopping = {}
            for (var i in data.Reservations) {
                var ins = data.Reservations[i].Instances[0]
                var name = findInstanceName(ins)
                if (name === null) continue;

                //it includes terminated instances
                ec2_list_total[name + '#' + ins.InstanceId] = ins.InstanceId

                //make sure these conditions are exclusive.
                if (ins.State.Name == "running")
                    ec2_list_running[name + '#' + ins.InstanceId] = ins.InstanceId;

                if (ins.State.Name == "stopped")
                    ec2_list_stopped[name + '#' + ins.InstanceId] = ins.InstanceId;

                if (ins.State.Name == "pending")
                    ec2_list_pending[name + '#' + ins.InstanceId] = ins.InstanceId;

                if (ins.State.Name == "stopping")
                    ec2_list_stopping[name + '#' + ins.InstanceId] = ins.InstanceId;

            }
            var return_list = [];
            return_list.push(ec2_list_running);
            return_list.push(ec2_list_stopped);
            return_list.push(ec2_list_stopping);
            return_list.push(ec2_list_pending);
            return_list.push(ec2_list_total);

            //console.log('list', return_list);
            return_vars['return_list'] = return_list;
            return return_vars;
        })
        .then(async(return_vars) => {
            //adjust total messages
            totalMessages = return_vars['totalMessages'];
            // console.log(totalMessages, ' yes')
            ec2_list_pending = return_vars['return_list'][3];
            ec2_list_stopped = return_vars['return_list'][1];
            ec2_list_stopping = return_vars['return_list'][2];
            ec2_list_running = return_vars['return_list'][0];
            ec2_list_total = return_vars['return_list'][4];
            totalMessages -= Object.keys(ec2_list_pending).length * thresholdTasks;
            if (totalMessages < 0) totalMessages = 0;

            console.log("Adjusted Total messages: ", totalMessages)

            console.log("Count: ", Object.keys(ec2_list_pending).length + Object.keys(ec2_list_stopped).length + Object.keys(ec2_list_stopping).length + Object.keys(ec2_list_running).length, "  Running: ", ec2_list_running, "  Stopped: ", ec2_list_stopped, "  Pending: ", ec2_list_pending, "\n\n");
            //scale_up
            var expectedTotalInstances = Math.ceil(totalMessages / thresholdTasks);
            var requiredInstances = expectedTotalInstances - Object.keys(ec2_list_running).length - Object.keys(ec2_list_pending).length;
            if (requiredInstances < 0) requiredInstances = 0;

            // if requiredinstances <= 0 => Ignore
            // if requiredInstance > 0 logic!

            console.log("Required : ", requiredInstances);
            if (requiredInstances > 0) {

                requiredInstances = Math.min(maxCountInstances, requiredInstances);
                //Allocating instances if less

                //Can stopped instances suffice?
                while (requiredInstances > 0) {
                    if (Object.keys(ec2_list_stopped).length > 0) {
                        //start a stopped instance
                        // Call EC2 to start the selected instances
                        // console.log('before', ec2_list_pending, ec2_list_stopped)
                        var temp = []
                        temp.push(Object.values(ec2_list_stopped)[0])

                        try {
                            ec2_list_pending[Object.keys(ec2_list_stopped)[0]] = Object.values(ec2_list_stopped)[0]
                            delete ec2_list_stopped[Object.keys(ec2_list_stopped)[0]];
                        } catch {
                            console.log("Already handled!")
                        }
                        console.log('after', ec2_list_pending, ec2_list_stopped)
                        params_for_starting = {
                            InstanceIds: temp,
                            DryRun: true
                        }
                        ec2.startInstances(params_for_starting, function(err, data) {
                            if (err && err.code === 'DryRunOperation') {
                                params_for_starting.DryRun = false;
                                ec2.startInstances(params_for_starting, function(err, data) {
                                    if (err) {
                                        console.log("Error", err);
                                    } else if (data) {
                                        console.log("Success started", data.StartingInstances);

                                        //might need to chnage updating method. may use general update from describe. this is manual
                                        try {
                                            ec2_list_running[Object.keys(ec2_list_pending)[0]] = Object.values(ec2_list_pending)[0];
                                            delete ec2_list_pending[Object.keys(ec2_list_pending)[0]];
                                        } catch {
                                            console.log("Already handled")
                                        }

                                    }
                                });
                            } else {
                                console.log("You don't have permission to start instances.");
                            }
                        });

                    } else {
                        //allocate new instance
                        console.log("CREATING NEW INSTANCE! ")
                        var instanceParams = {
                            ImageId: 'ami-0c27801a8667e75d3',
                            InstanceType: 't2.micro',
                            KeyName: 'cloudcomputingkey',
                            MinCount: 1,
                            MaxCount: 1
                        };
                        if (!tagIterator) tagIterator = 0;
                        console.log('tag_before: ', tagIterator)
                        previousTag = tagIterator;
                        tagIterator = generateTag(tagIterator, return_vars['return_list']);
                        console.log('tag_new: ', tagIterator)

                        if ((Object.keys(ec2_list_pending).length + Object.keys(ec2_list_running).length + Object.keys(ec2_list_stopped).length + Object.keys(ec2_list_stopping).length) < maxCountInstances)
                            try {
                                var instanceId = null;
                                instanceId = await createInstance(instanceParams, 'app-instance-' + tagIterator);
                                ec2_list_pending['app-instance-' + tagIterator + '#' + instanceId] = instanceId;
                            }
                        catch {
                            console.log("Error in creating new instances")
                        }
                        // testSleep(1000);
                        // requiredInstances -= 1;

                    }

                    await sleep(3000);
                    requiredInstances -= 1;
                }

            }


            // wrapperGetQueueAtttributes(params_for_request_queue);
        });

}


var scalingLogic = async function() {
    await wrapperGetQueueAtttributes();
    await sleep(5000);
    await scalingLogic()
};

scalingLogic();

// setInterval(scalingLogic, 5000);
