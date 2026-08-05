First the environment. This is Mojaloop v17 and these are the specific service versions - central-ledger v19.14.0, ml-api-adapter v16.9.2, quoting-service v17.14.4, ALS v17.15.2, inter-scheme-proxy-adapter v1.3.3). Just so that we are both talking about the same stack.



I don't have the raw Kafka captures but this is the mapping of topics and messages.

-Quotes are on topic-quotes-post, topic-quotes-put and topic-quotes-get

-FX Quotes are on topic-fx-quotes-post, topic-fx-quotes-put and topic-fx-quotes-get

-Transfers and fxTransfers are both on topic-transfer-prepare, topic-transfer-fulfil and topic-transfer-get.

-Position movement is on topic-transfer-position and topic-transfer-position-batch.

-The outbound callbacks going back to the DFSPs are on topic-notification-event.

Settlement window close is on topic-deferredsettlement-close.

---------------------

For the third question ALS does not interact with Kafka. it is https end to end. Details of the parties i.e payee or payer should be in the quotes i.e the kafka topics that have the quote messages