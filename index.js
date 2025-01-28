const AWS = require('aws-sdk');
const uuid = require('uuid');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const scheduler = new AWS.Scheduler();
const lambda = new AWS.Lambda();

exports.handler = async (event) => {
    console.log("Received event:", JSON.stringify(event));

    // Handle OPTIONS requests for CORS
    if (event.requestContext.http.method === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
            },
            body: '',
        };
    }

    try {
        // Handle POST requests (event creation)
        if (event.requestContext.http.method === 'POST') {
            const body = JSON.parse(event.body);
            console.log("Parsed body:", body);

            const { eventName, eventDate, eventTime } = body;

            // Validate input
            if (!eventName || !eventDate || !eventTime) {
                console.error("Missing required fields:", body);
                return {
                    statusCode: 400,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': '*',
                        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
                    },
                    body: JSON.stringify({ message: 'Missing required fields' }),
                };
            }

            // Generate unique EventID
            const eventId = uuid.v4();
            console.log("Generated EventID:", eventId);

            // Save event to DynamoDB
            const params = {
                TableName: 'Events',
                Item: {
                    EventID: eventId,
                    EventName: eventName,
                    EventDate: eventDate,
                    EventTime: eventTime,
                },
            };

            await dynamodb.put(params).promise();
            console.log("Event successfully saved to DynamoDB");

            // Directly invoke the BELLCreateRemindersFunction for Immediate reminder
            await invokeImmediateReminder(eventName);

            // Create EventBridge rules for subsequent reminders
            await createReminderRule(eventId, 'OneWeek', calculateTimestamp(eventDate, eventTime, -7), eventName);
            await createReminderRule(eventId, 'ThreeDays', calculateTimestamp(eventDate, eventTime, -3), eventName);
            await createReminderRule(eventId, 'OneDay', calculateTimestamp(eventDate, eventTime, -1), eventName);

            // Return success response
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
                },
                body: JSON.stringify({ message: 'Event created successfully!', eventID: eventId }),
            };
        }

        // Unsupported HTTP methods
        console.error("Unsupported HTTP method:", event.requestContext.http.method);
        return {
            statusCode: 405,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
            },
            body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    } catch (error) {
        console.error("Error occurred:", error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
            },
            body: JSON.stringify({ message: 'Internal server error' }),
        };
    }
};

// Helper function to immediately invoke the BELLCreateRemindersFunction
const invokeImmediateReminder = async (eventName) => {
    const reminderLambdaArn = process.env.ReminderLambdaArn; // Get ARN from environment variable

    if (!reminderLambdaArn) {
        throw new Error('ReminderLambdaArn is not set in environment variables.');
    }

    console.info(`Invoking BELLCreateRemindersFunction for Immediate reminder with eventName: ${eventName}`);
    try {
        await lambda.invoke({
            FunctionName: reminderLambdaArn,
            InvocationType: 'Event', // Asynchronous invocation
            Payload: JSON.stringify({
                eventName: eventName,
                reminderType: 'Immediate',
            }),
        }).promise();
        console.info("Immediate reminder sent successfully.");
    } catch (error) {
        console.error("Failed to send Immediate reminder:", error);
        throw error;
    }
};

// Function to create an EventBridge rule
const createReminderRule = async (eventId, reminderType, timestamp, eventName) => {
    const ruleName = `${eventId}-${reminderType}`;
    const reminderLambdaArn = process.env.ReminderLambdaArn; // Get ARN from environment variable

    if (!reminderLambdaArn) {
        throw new Error('ReminderLambdaArn is not set in environment variables.');
    }

    const currentTimestamp = new Date().getTime();
    if (timestamp < currentTimestamp) {
        console.warn(`Skipping ${reminderType} schedule for ${ruleName}: Timestamp is in the past.`);
        return;
    }

    const date = new Date(timestamp);
    const cronExpression = `cron(${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} ? ${date.getUTCFullYear()})`;

    console.info(`Final cron expression for ${ruleName}: ${cronExpression}`);

    const params = {
        Name: ruleName,
        ScheduleExpression: cronExpression,
        State: 'ENABLED',
        Target: {
            Arn: reminderLambdaArn,
            RoleArn: process.env.SchedulerRoleArn,
            Input: JSON.stringify({ eventName, reminderType }),
        },
        FlexibleTimeWindow: {
            Mode: 'OFF',
        },
    };

    console.info(`Creating EventBridge Scheduler for: ${ruleName} with cron: ${cronExpression}`);
    try {
        await scheduler.createSchedule(params).promise();
        console.info(`Schedule ${ruleName} created successfully.`);
    } catch (error) {
        console.error(`Failed to create schedule ${ruleName}:`, error);
        throw error;
    }
};

// Helper function to calculate timestamps
const calculateTimestamp = (eventDate, eventTime, daysOffset) => {
    const eventTimestamp = new Date(`${eventDate}T${eventTime}:00Z`).getTime();
    return eventTimestamp + daysOffset * 24 * 60 * 60 * 1000;
};




