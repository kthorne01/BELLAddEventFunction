const AWS = require('aws-sdk');
const uuid = require('uuid');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const eventbridge = new AWS.EventBridge();

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event));

    if (event.requestContext.http.method === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
            },
            body: ''
        };
    }

    try {
        if (event.requestContext.http.method === 'POST') {
            const body = JSON.parse(event.body);
            const { eventName, eventDate, eventTime } = body;

            if (!eventName || !eventDate || !eventTime) {
                return {
                    statusCode: 400,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                    },
                    body: JSON.stringify({ message: 'Missing required fields' }),
                };
            }

            const eventId = uuid.v4();
            const eventTimestamp = new Date(`${eventDate}T${eventTime}:00Z`).getTime();

            // Save event to DynamoDB
            await dynamodb.put({
                TableName: 'Events',
                Item: {
                    EventID: eventId,
                    EventName: eventName,
                    EventDate: eventDate,
                    EventTime: eventTime,
                },
            }).promise();

            // Create EventBridge rules for reminders
            await createReminderRule(eventId, 'Immediate', Date.now(), eventName);
            await createReminderRule(eventId, 'OneWeek', eventTimestamp - 7 * 24 * 60 * 60 * 1000, eventName);
            await createReminderRule(eventId, 'ThreeDays', eventTimestamp - 3 * 24 * 60 * 60 * 1000, eventName);
            await createReminderRule(eventId, 'OneDay', eventTimestamp - 24 * 60 * 60 * 1000, eventName);

            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
                body: JSON.stringify({ message: 'Event created successfully!', eventID: eventId }),
            };
        }

        return {
            statusCode: 405,
            headers: {
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    } catch (error) {
        console.error("Error occurred:", error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify({ message: 'Internal server error' }),
        };
    }
};

const createReminderRule = async (eventId, reminderType, timestamp, eventName) => {
    const ruleName = `${eventId}-${reminderType}`;
    const params = {
        Name: ruleName,
        ScheduleExpression: `cron(${new Date(timestamp).getUTCMinutes()} ${new Date(timestamp).getUTCHours()} ${new Date(timestamp).getUTCDate()} ${new Date(timestamp).getUTCMonth() + 1} ? ${new Date(timestamp).getUTCFullYear()})`,
        State: 'ENABLED',
    };

    await eventbridge.putRule(params).promise();

    await eventbridge.putTargets({
        Rule: ruleName,
        Targets: [
            {
                Id: `${ruleName}-target`,
                Arn: process.env.ReminderLambdaArn, // ARN of the reminder Lambda function
                Input: JSON.stringify({ eventName, reminderType }),
            },
        ],
    }).promise();
};

