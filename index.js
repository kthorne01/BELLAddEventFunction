const AWS = require('aws-sdk');
const uuid = require('uuid');
const dynamodb = new AWS.DynamoDB.DocumentClient();

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


