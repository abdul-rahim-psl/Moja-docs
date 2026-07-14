Investigate the Kafka topics used by Mojaloop services to publish quotation and transfer-related messages, specifically from quoting-service and ml-api-adapter. The goal is to identify the relevant topics, understand the message flow and payloads, and then create a PPA prototype that consumes the required quotation and transfer events.
Scope / Action Items * Review quoting-service configuration and code to identify Kafka topics used for quote requests, responses, and notifications.

Review ml-api-adapter configuration and code to identify Kafka topics used for transfer requests, state changes, and transfer notifications.
Confirm the exact topic names, message direction, producers, and consumers.
Identify the message payload structure for relevant quotation and transfer events.
Document any required Kafka consumer configuration, including consumer group, partitions, offsets, and environment variables.
Verify whether the topics are configurable via Helm values, environment variables, or service config files.
Create a PPA prototype service/application.
Set up Kafka consumers in the PPA prototype for the identified relevant quotation and transfer topics.
Validate that the prototype can consume messages from the identified Kafka topics.
Log or expose consumed messages in a simple format for analysis and PPA design validation.

Acceptance Criteria * Kafka topics for quotation-related messages are identified and documented.

Kafka topics for transfer notification/messages from ml-api-adapter are identified and documented.
Producer/consumer flow is mapped for each relevant topic.
Sample message payloads or schema references are provided where available.
Required Kafka consumer configuration is documented.
PPA prototype is created with consumers for the identified relevant Kafka topics.
Prototype successfully consumes quotation and transfer messages from Kafka.
Any unknowns, assumptions, or environment-specific differences are captured.