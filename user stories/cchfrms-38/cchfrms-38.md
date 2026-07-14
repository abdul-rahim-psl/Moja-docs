Progress the PPA prototype by ingesting Mojaloop transfer messages into Tazama, starting with pacs.008 and pacs.002 transfer flows. As per the Mojaloop FSPIOP to ISO 20022 mapping, POST /transfers maps to pacs.008, while transfer fulfil/update flows map to pacs.002.
Scope * Review current PPA prototype implementation and README.

Consume transfer-related Kafka messages from:
topic-transfer-prepare
topic-transfer-fulfil
Decode transfer payloads from Base64 where required.
Convert/normalize decoded payloads into the JSON format expected by Tazama.
Ingest pacs.008 and pacs.002 messages into the Tazama pipeline.
Validate successful ingestion through Tazama logs/output.
Document payload format, decoding steps, and ingestion flow.

References * FSPIOP to ISO 20022 Mapping (https://github.com/mojaloop/ml-schema-transformer-lib/blob/main/FSPIOP%20to%20ISO%2020022%20Mapping.md#fspiop-to-iso-20022-payload-mapping)

PPA Prototype README (https://github.com/abdul-rahim-psl/ppa-prototype/blob/main/README.md)

Acceptance Criteria * pacs.008 transfer prepare messages are consumed and ingested into Tazama.

pacs.002 transfer fulfil messages are consumed and ingested into Tazama.
Base64 decoding is handled where required.
Message format expected by Tazama is documented.
Successful ingestion is verified through logs or output files.
Any gaps for non-transfer FSPIOP messages are documented separately.