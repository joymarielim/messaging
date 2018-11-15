'use strict';

const AWS = require('aws-sdk');
const uuidv1 = require('uuid/v1');
AWS.config.update({
    region: 'us-east-1'
});


let applicationId = 'c296eac3-e82e-11e8-9c1b-b9fd2a0aeca7';

let publishMessage = async (event, context) => {
    let message = JSON.parse(event.body);
    let sns = new AWS.SNS();
    let dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

    let messageId = uuidv1();
    message.messageId = messageId;
    let now = (new Date).getTime();
    message.createTime = now;
    message.scheduleTime = now;
    let params = {
        Item: {
            "applicationId": {
                S: message.applicationId
            },
            "messageId": {
                S: messageId
            },
            "subject": {
                S: message.subject
            },
            "body": {
                S: message.body
            },
            "author": {
                S: message.author
            },
            "scheduleTime": {
                N: String(now)
            },
            "createTime": {
                N: String(now)
            }
        },
        ReturnConsumedCapacity: "TOTAL",
        TableName: "joylim-notifications-master-dynamodb"
    };

    let dynamoDBResponse = await dynamodb.putItem(params).promise();
    console.log('dynamoDBResponse', dynamoDBResponse);
    console.log('message', JSON.stringify(message));
    let response = await sns.publish({
        Message: JSON.stringify({default: JSON.stringify(message), lambda: JSON.stringify(message)}),
        MessageStructure: 'json',
        Subject: message.subject,
        TargetArn: 'arn:aws:sns:us-east-1:450119628579:messagingDevTopic',
        MessageAttributes: {
            'applicationId': {DataType: 'String', StringValue: applicationId},
            'messageId': {DataType: 'String', StringValue: messageId}
        }
    }).promise();
    message.snsMessageId = response.MessageId;

    let paramsUpdate = {
        Item: {
            "applicationId": {
                S: message.applicationId
            },
            "messageId": {
                S: messageId
            },
            "subject": {
                S: message.subject
            },
            "body": {
                S: message.body
            },
            "author": {
                S: message.author
            },
            "snsMessageId": {
                S: message.snsMessageId
            }
        },
        ReturnConsumedCapacity: "TOTAL",
        TableName: "joylim-notifications-master-dynamodb"
    };
    let response2 = await dynamodb.putItem(paramsUpdate).promise();
    console.log('response', response2);
    return {
        statusCode: 200,
        body: JSON.stringify(message)
    }
};

let subscribeMessage = async (event, context) => {
    console.log('event', event);
    var SnsMessageId = event.Records[0].Sns.MessageId;
    var SnsPublishTime = event.Records[0].Sns.Timestamp;
    var SnsTopicArn = event.Records[0].Sns.TopicArn;
    var LambdaReceiveTime = new Date().toString();
    let message = JSON.parse(event.Records[0].Sns.Message);
    console.log('parsedMessage', message);
    var itemParams = {
        Item: {
            SnsTopicArn: {S: SnsTopicArn},
            SnsPublishTime: {S: SnsPublishTime}, SnsMessageId: {S: SnsMessageId},
            LambdaReceiveTime: {S: LambdaReceiveTime}
        }
    };
    console.log('message', event.Records[0].Sns);
    let uiclMessageId = event.Records[0].Sns.MessageAttributes.messageId.Value;

    //TODO get roles for which the message applies for

    //TODO get the users of the role
    let userIds = [
        '080a191e-e83e-11e8-9f32-f2801f1b9fd1',
        '080a1bbc-e83e-11e8-9f32-f2801f1b9fd1',
        '080a1d1a-e83e-11e8-9f32-f2801f1b9fd1',
        '080a1e5a-e83e-11e8-9f32-f2801f1b9fd1',
        '080a2260-e83e-11e8-9f32-f2801f1b9fd1',
        '080a23d2-e83e-11e8-9f32-f2801f1b9fd1',
        '080a256c-e83e-11e8-9f32-f2801f1b9fd1',
        '080a26f2-e83e-11e8-9f32-f2801f1b9fd1',
        '080a2878-e83e-11e8-9f32-f2801f1b9fd1',
        '080a29c2-e83e-11e8-9f32-f2801f1b9fd1'];

    let putRequests = [];
    for (let i = 0; i < userIds.length; i++) {
        putRequests.push({
            PutRequest: {
                Item: {
                    "applicationIdUserId": {
                        S: `${applicationId}_${userIds[i]}`
                    },
                    "messageId": {
                        S: `${uiclMessageId}`
                    },
                    "userId": {
                        S: userIds[i]
                    },
                    "scheduleTime": {
                        N: String(message.scheduleTime)
                    },
                    "createTime": {
                        N: String(message.createTime)
                    },
                    "subject": {
                        S: message.subject
                    },
                    "body": {
                        S: message.body
                    },
                    "author": {
                        S: message.author
                    },
                    "snsMessageId": {
                        S: SnsMessageId
                    }
                }
            }
        });
    }

    //TODO write messages as batch
    let dynamodb = new AWS.DynamoDB({apiVersion: '2012-08-10'});
    let params = {RequestItems: {"joylim-usernotificationsbyschedule-master-dynamodb": putRequests}};
    console.log('JSON.stringify(params)=' + JSON.stringify(params));

    let response = await dynamodb.batchWriteItem(params).promise();
    console.log('JSON.stringify(response)=' + JSON.stringify(response));
    let params2 = {RequestItems: {"joylim-usernotificationsbymessageid-master-dynamodb": putRequests}};
    console.log('JSON.stringify(params2)=' + JSON.stringify(params2));
    let response2 = await dynamodb.batchWriteItem(params2).promise();
    console.log('JSON.stringify(response2)=' + JSON.stringify(response2));

    for (let i = 0; i < putRequests.length; i++) {
        console.log('JSON.stringify(putRequests[i])=' + JSON.stringify(putRequests[i]));
        //publish to user queues
        let sqs = new AWS.SQS({apiVersion: '2012-11-05'});
        let createQueueParams = {
            QueueName: `${putRequests[i].PutRequest.Item.applicationIdUserId.S}_sqs`, /* required */
            Attributes: {
                'MessageRetentionPeriod': '1209600' //MAX VALUE, 14 days
            }
        };

        let createQueueResponse = await sqs.createQueue(createQueueParams).promise();
        console.log('createQueueResponse', createQueueResponse);
        let sqsMessage = {
            MessageBody: event.Records[0].Sns.Message, /* required */
            QueueUrl: createQueueResponse.QueueUrl, /* required */
            DelaySeconds: 0,
            MessageAttributes: {
                'applicationId': {DataType: 'String', StringValue: applicationId},
                'messageId': {DataType: 'String', StringValue: uiclMessageId}
            }
        };
        let sendMessageResponse = await sqs.sendMessage(sqsMessage).promise();
        console.log('sendMessageResponse', sendMessageResponse);
    }


};

let fetchNotifications = async (event, context) => {
    //create userQueue
    //publish toUserQueue
    //poll
};

module.exports.publishMessage = publishMessage;
module.exports.subscribeMessage = subscribeMessage;
