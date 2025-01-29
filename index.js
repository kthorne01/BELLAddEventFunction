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
            console.log("Invoking Immediate Reminder...");
            await invokeImmediateReminder(eventName, eventDate, eventTime);

            // Create EventBridge rules for subsequent reminders
            await createReminderRule(eventId, 'OneWeek', convertToUTCTimestamp(eventDate, eventTime, 7), eventName, eventDate, eventTime);
            await createReminderRule(eventId, 'ThreeDays', convertToUTCTimestamp(eventDate, eventTime, 3), eventName, eventDate, eventTime);
            await createReminderRule(eventId, 'OneDay', convertToUTCTimestamp(eventDate, eventTime, 1), eventName, eventDate, eventTime);

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
const invokeImmediateReminder = async (eventName, eventDate, eventTime) => {
    const reminderLambdaArn = process.env.ReminderLambdaArn; // Get ARN from environment variable

    if (!reminderLambdaArn) {
        throw new Error('ReminderLambdaArn is not set in environment variables.');
    }

    console.info(`Invoking BELLCreateRemindersFunction for Immediate reminder with eventName: ${eventName}, eventDate: ${eventDate}, eventTime: ${eventTime}`);
    try {
        await lambda.invoke({
            FunctionName: reminderLambdaArn,
            InvocationType: 'Event', // Asynchronous invocation
            Payload: JSON.stringify({
                eventName,
                eventDate,
                eventTime,
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
const createReminderRule = async (eventId, reminderType, timestamp, eventName, eventDate, eventTime) => {
    const ruleName = `${eventId}-${reminderType}`;
    const reminderLambdaArn = process.env.ReminderLambdaArn; // Get ARN from environment variable

    if (!reminderLambdaArn) {
        throw new Error('ReminderLambdaArn is not set in environment variables.');
    }

    const currentTimestamp = new Date().getTime();
    const eventTimestamp = convertToUTCTimestamp(eventDate, eventTime, 0); // Convert event date/time to UTC timestamp

    // Ensure the reminder timestamp is BEFORE the event but NOT in the past
    if (timestamp <= currentTimestamp) {
        console.warn(`Skipping ${reminderType} schedule for ${ruleName}: Reminder time is already in the past.`);
        return;
    }

    if (timestamp >= eventTimestamp) {
        console.warn(`Skipping ${reminderType} schedule for ${ruleName}: Reminder must be scheduled before the event.`);
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
            Input: JSON.stringify({ eventName, eventDate, eventTime, reminderType }),
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

// Helper function to convert event date/time to UTC timestamp
const convertToUTCTimestamp = (eventDate, eventTime, daysBefore) => {
    const localDateTime = new Date(`${eventDate}T${eventTime}:00`); // Local time
    const utcDateTime = new Date(localDateTime.getTime() - (daysBefore * 24 * 60 * 60 * 1000)); // Subtract daysBefore

    console.info(`Converted timestamp for ${daysBefore} days before event: ${utcDateTime.toISOString()}`);
    
    return utcDateTime.getTime();
};






