# Mojaloop TTK Happy Flows

This document maps the happy-path flows available in the local
`ml-core-test-harness` TTK collections. It is written as a flow guide: what the
collection is trying to prove, which API sequence it runs, and which Docker
profile normally triggers it.

The source collections live under:

```text
ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections
```

The shared environment values live in:

```text
ml-core-test-harness/docker/ml-testing-toolkit/test-cases/environments/default-env.json
```

## Profile Map

| Docker profile | TTK input | Labels | Main happy flow |
| --- | --- | --- | --- |
| `ttk-provisioning` | `collections/provisioning` | `std` | Standard Hub, payer, payee, callback, and funding setup. |
| `ttk-tests` | `collections/tests` | `std` | Simple P2P transfer test. |
| `ttk-provisioning-gp` | `collections/provisioning` | `std-gp` | Larger golden-path provisioning set. |
| `ttk-tests-gp` | `collections/tests` | `std-gp` | Larger golden-path test suite. |
| `ttk-provisioning-fx` | `collections/provisioning` | `std,fx` | Standard provisioning plus FX participants. |
| `ttk-fx-tests` | `collections/tests` | `std,fx` | Standard P2P plus FX quote/transfer flow. |
| `ttk-provisioning-fx-sdk` | `collections/provisioning` | `std,fx,fx-sdk` | Standard and FX provisioning for SDK-backed FX participants. |
| `ttk-fx-sdk-tests` | `collections/tests` | `std,fx,fx-sdk` | FX tests with SDK-backed FX participants. |

## Standard Provisioning

Source:

```text
collections/provisioning/master.json
collections/provisioning/hub_setup.json
collections/provisioning/hub_setup_prod.json
collections/provisioning/participant_receiver.json
collections/provisioning/participant_sender.json
collections/provisioning/fxp.json
```

Plain-English flow:

```text
create Hub settlement and reconciliation accounts
-> create settlement models
-> register ACCOUNT_ID oracle
-> register MSISDN oracle
-> create payee participant: payeefsp
-> set payeefsp position and limits
-> register payeefsp callback URLs for participants, parties, quotes, transfers, errors, bulk, and FX
-> create payer participant: testingtoolkitdfsp
-> set testingtoolkitdfsp position and limits
-> register testingtoolkitdfsp callback URLs for participants, parties, quotes, transfers, errors, bulk, and FX
-> fund testingtoolkitdfsp settlement accounts
-> create FX provider participant: perffxp
-> set FX provider position and limits
-> register FX provider callbacks
-> fund FX provider settlement accounts
```

What this leaves behind:

```text
Hub accounts and settlement models exist
-> lookup oracles are registered
-> payer and payee participants exist in Central Ledger
-> callback endpoint templates are registered
-> payer has funded settlement accounts
-> FX provider is ready for FX tests
```

The simple P2P test depends mainly on the payer/payee setup and funding. The
FXP setup is included by the standard provisioning collection in this harness,
but it is only needed for FX flows.

## Standard P2P Transfer

Source:

```text
collections/tests/master.json
collections/tests/p2p.json
```

Triggered by:

```text
ttk-tests
```

Plain-English flow:

```text
register payee party in ALS
-> discover payee party
-> request quote
-> prepare transfer
-> receive committed transfer callback
```

Main API sequence:

```text
POST /participants/{Type}/{ID}
-> GET /parties/{Type}/{ID}
-> POST /quotes
-> POST /transfers
```

With the default environment, this is:

```text
POST http://account-lookup-service:4002/participants/MSISDN/27713803912
-> GET http://account-lookup-service:4002/parties/MSISDN/27713803912
-> POST http://quoting-service:3002/quotes
-> POST http://ml-api-adapter:3000/transfers
```

Business result:

```text
testingtoolkitdfsp sends 100 XXX to payeefsp
-> quote callback returns transferAmount, expiration, ilpPacket, and condition
-> transfer callback returns transferState: COMMITTED
```

## Golden-Path Provisioning

Source:

```text
collections/provisioning/for_golden_path/master.json
collections/provisioning/for_golden_path/MojaloopHub_Setup
collections/provisioning/for_golden_path/MojaloopHub_Setup_prod
collections/provisioning/for_golden_path/MojaloopSims_Onboarding
collections/provisioning/for_golden_path/CGS_Specific
```

Triggered by:

```text
ttk-provisioning-gp
```

Plain-English flow:

```text
configure Hub accounts and settlement models
-> register production-style oracle setup
-> onboard payerfsp
-> onboard payeefsp
-> onboard noresponsepayeefsp
-> onboard testfsp1 through testfsp4
-> onboard testingtoolkitdfsp and ttkpayeefsp
-> onboard FX test participants
-> add users and ALS registrations for the new simulators
-> adjust participant limits
-> register extra CGS oracle data
```

What this enables:

```text
multi-participant P2P tests
-> settlement-management tests across several FSPs
-> participant activation/inactivation tests
-> duplicate transfer handling tests
-> FX and transaction-request-service tests
```

## Golden-Path P2P Variants

Source:

```text
collections/tests/golden_path/feature_tests/p2p_money_transfer
```

Plain-English happy flows:

```text
standard P2P:
register party in ALS -> seed simulator party -> discover party -> request quote -> prepare/commit transfer

P2P with sub-id:
register party sub-id in ALS -> seed simulator party -> discover party sub-id -> request quote -> prepare/commit transfer

P2P with accented unicode:
register accented party identifier -> seed party -> discover party -> request quote -> prepare/commit transfer

P2P with Burmese unicode:
register Burmese party identifier -> seed party -> discover party -> request quote -> prepare/commit transfer

P2P with balance checks:
register party -> seed party -> discover party -> read payer/payee balances -> request quote -> prepare/commit transfer -> read payer/payee balances again

P2P with TTK payee and balance checks:
register TTK payee party -> discover party -> read balances -> request quote -> prepare/commit transfer -> read balances again
```

Core API shapes:

```text
POST /participants/{Type}/{ID}
POST /participants/{Type}/{ID}/{SubId}
POST /repository/parties
GET /parties/{Type}/{ID}
GET /parties/{Type}/{ID}/{SubId}
GET /participants/{name}/accounts
POST /quotes
POST /transfers
```

## On-Us P2P Transfer

Source:

```text
collections/tests/golden_path/p2p_on_us_transfers/p2p_money_transfer_on_us.json
```

Plain-English flow:

```text
register payee party in ALS
-> seed simulator party
-> request quote where payer and payee are handled inside the same FSP context
-> prepare/commit transfer
```

Main API sequence:

```text
POST /participants/{Type}/{ID}
-> POST /repository/parties
-> POST /quotes
-> POST /transfers
```

## FX Transfer

Source:

```text
collections/tests/fx/golden_path/feature_tests/happy_path/fx_tests.json
```

Triggered by:

```text
ttk-fx-tests
ttk-fx-sdk-tests
```

Plain-English flow:

```text
register payee party in ALS
-> discover payee party
-> request FX quote
-> request normal quote using FX quote result
-> prepare FX transfer
-> prepare final transfer
```

Main API sequence:

```text
POST /participants/{Type}/{ID}
-> GET /parties/{Type}/{ID}
-> POST /fxQuotes
-> POST /quotes
-> POST /fxTransfers
-> POST /transfers
```

Business result:

```text
payer DFSP discovers payee
-> FX provider quotes currency conversion
-> payee quote is created with the FX terms
-> FX leg is prepared
-> final transfer leg is prepared and committed
```

## Quote Service Happy Flow

Source:

```text
collections/tests/golden_path/quoting_service/quoting_service.json
```

Plain-English flow:

```text
send quote
-> check quoting-service health
-> retrieve quote by quoteId
-> send more valid quotes
-> retrieve stored quote state
```

Main API sequence:

```text
POST /quotes
-> GET /health
-> GET /quotes/{ID}
-> POST /quotes
-> POST /quotes
-> GET /quotes/{ID}
```

## Get Transfers Flow

Source:

```text
collections/tests/golden_path/feature_tests/get_transfers.json
```

Plain-English flow:

```text
request quote
-> prepare transfer
-> retrieve transfer by transferId
-> repeat retrieval using the transfer id from the request and callback context
```

Main API sequence:

```text
POST /quotes
-> POST /transfers
-> GET /transfers/{ID}
```

## Funds In

Source:

```text
collections/tests/golden_path/feature_tests/funds_in/funds_in_ttk.json
```

Plain-English flow:

```text
read participant account balances
-> read Hub account balances
-> deposit funds into participant settlement account
-> read participant account balances again
-> read Hub account balances again
-> retrieve the generated funds-in transfer
```

Main API sequence:

```text
GET /participants/{name}/accounts
-> GET /participants/{Hub}/accounts
-> POST /participants/{name}/accounts/{accountId}
-> GET /participants/{name}/accounts
-> GET /participants/{Hub}/accounts
-> GET /transfers/{ID}
```

## Funds Out: Reserve And Commit

Source:

```text
collections/tests/golden_path/feature_tests/funds_out/Reserve&Commit/funds_out_commit.json
```

Plain-English flow:

```text
read participant and Hub balances
-> deposit funds into participant settlement account
-> verify balances and generated transfer
-> reserve funds out
-> verify balances
-> commit funds out
-> verify balances and transfer state
```

Main API sequence:

```text
GET /participants/{name}/accounts
-> GET /participants/{Hub}/accounts
-> POST /participants/{name}/accounts/{accountId}
-> GET /transfers/{ID}
-> PUT /participants/{name}/accounts/{accountId}/transfers/{ID}
-> GET /participants/{name}/accounts
-> GET /participants/{Hub}/accounts
-> GET /transfers/{ID}
```

## Funds Out: Reserve And Abort

Source:

```text
collections/tests/golden_path/feature_tests/funds_out/Reserve&Abort/funds_out_abort.json
```

Plain-English flow:

```text
read participant and Hub balances
-> deposit funds into participant settlement account
-> verify balances and generated transfer
-> reserve funds out
-> abort funds out
-> verify balances and transfer state
```

Main API sequence:

```text
GET /participants/{name}/accounts
-> GET /participants/{Hub}/accounts
-> POST /participants/{name}/accounts/{accountId}
-> GET /transfers/{ID}
-> PUT /participants/{name}/accounts/{accountId}/transfers/{ID}
-> GET /participants/{name}/accounts
-> GET /participants/{Hub}/accounts
-> GET /transfers/{ID}
```

## Participant Activation And Account Activation

Source:

```text
collections/tests/golden_path/feature_tests/Active_Inactive_participants
```

Plain-English flows:

```text
participant inactive/active:
deactivate participant -> attempt quote/transfer path -> reactivate participant -> quote -> transfer succeeds

participant account inactive/active:
read participant accounts -> deactivate account -> attempt quote/transfer path -> reactivate account -> quote -> transfer succeeds
```

Main API sequence:

```text
PUT /participants/{name}
-> POST /quotes
-> POST /transfers
-> PUT /participants/{name}
-> POST /quotes
-> POST /transfers
```

For account state:

```text
GET /participants/{name}/accounts
-> PUT /participants/{name}/accounts/{accountId}
-> POST /quotes
-> POST /transfers
-> PUT /participants/{name}/accounts/{accountId}
-> POST /quotes
-> POST /transfers
```

## Duplicate Transfer Handling

Source:

```text
collections/tests/golden_path/feature_tests/duplicate_handling/transfers
```

Plain-English happy flows:

```text
duplicate fulfil commit:
request quote -> quote callback -> prepare transfer -> fulfil transfer -> repeat same fulfil -> retrieve transfer

duplicate fulfil reject:
request quote -> quote callback -> prepare transfer -> reject transfer -> repeat same rejection -> retrieve transfer

original transfer already committed:
register party -> seed simulator party -> request quote -> prepare transfer -> repeat prepare for same transfer
```

Main API sequence:

```text
POST /quotes
-> PUT /quotes/{ID}
-> POST /transfers
-> PUT /transfers/{ID}
-> PUT /transfers/{ID}
-> GET /transfers/{ID}
```

For rejection:

```text
POST /quotes
-> PUT /quotes/{ID}
-> POST /transfers
-> PUT /transfers/{ID}/error
-> PUT /transfers/{ID}/error
-> GET /transfers/{ID}
```

## Patch Notifications

Source:

```text
collections/tests/golden_path/feature_tests/patch_notifications/patch_notification.json
```

Plain-English flows:

```text
reserved then committed notification:
request quote -> prepare transfer -> payee receives PATCH notification with COMMITTED

invalid fulfilment then aborted notification:
request quote -> prepare transfer -> inspect transfer state after ABORTED notification
```

Main API sequence:

```text
POST /quotes
-> POST /transfers
-> GET /transfers/{ID}
```

## Resource-Based Participants API

Source:

```text
collections/tests/golden_path/feature_tests/resources_based/participants/participants.json
```

Plain-English flow:

```text
create participant lookup resource
-> retrieve participant lookup resource
-> update participant lookup resource
-> delete participant lookup resource
-> send participant error callback
-> repeat the same resource operations for batch/alternate participant forms
```

Main API sequence:

```text
POST /participants/{Type}/{ID}
-> GET /participants/{Type}/{ID}
-> PUT /participants/{Type}/{ID}
-> DELETE /participants/{Type}/{ID}
-> PUT /participants/{Type}/{ID}/error
-> POST /participants
-> PUT /participants/{ID}
-> PUT /participants/{ID}/error
```

## Transaction Request Service

Source:

```text
collections/tests/golden_path/transaction_request_service
```

Plain-English happy flows:

```text
transaction request received:
payee initiates transaction request -> payer sends RECEIVED state -> retrieve transaction request and confirm RECEIVED

transaction request rejected:
payee initiates transaction request -> payer sends REJECTED state -> retrieve transaction request and confirm REJECTED

authorizations:
request authorization by id -> send authorization result
```

Main API sequence:

```text
POST /transactionRequests
-> PUT /transactionRequests/{ID}
-> GET /transactionRequests/{ID}
```

For authorizations:

```text
GET /authorizations/{ID}
-> PUT /authorizations/{ID}
```

Note: the authorization requests are present in `authorizations.json`, but both
requests are currently marked `disabled: true` in this checkout. Treat this as
a documented possible flow, not an enabled request pair in the default run.

## Settlement Management

Source:

```text
collections/tests/golden_path/settlement_management
collections/tests/golden_path/settlement_management_prod
```

Plain-English happy flows:

```text
primary-currency settlement:
activate participant accounts -> close current settlement window -> create settlement -> run transfers between participants -> prepare settlement -> reserve settlement -> commit settlement -> settle settlement -> verify balances

second-currency settlement:
activate participant accounts for second currency -> close current settlement window -> create settlement -> run second-currency transfers -> prepare settlement -> reserve settlement -> commit settlement -> settle settlement -> verify balances

mixed settlement model:
activate participant accounts across currencies -> close settlement windows -> create deferred and default settlements -> run mixed-currency transfers -> prepare settlements -> reserve settlements -> commit settlements -> settle settlements -> verify balances
```

Main API sequence:

```text
GET /participants/{name}/accounts
-> PUT /participants/{name}/accounts/{accountId}
-> GET /settlementWindows
-> POST /settlementWindows/{ID}
-> POST /settlements
-> POST /quotes
-> POST /transfers
-> GET /settlements/{ID}
-> PUT /settlements/{ID}
-> GET /participants/{name}/accounts
```

## Flow Spine To Remember

Most happy flows are variations of one of these patterns:

```text
provisioning:
configure Hub -> register oracles -> onboard participants -> register callbacks -> fund accounts

P2P:
register/seed party -> discover party -> request quote -> prepare transfer -> receive committed callback

FX:
discover party -> request FX quote -> request quote -> prepare FX transfer -> prepare final transfer

settlement:
activate accounts -> create settlement -> run transfers -> prepare -> reserve -> commit -> settle

administrative funds movement:
read balances -> funds in or funds out operation -> verify balances -> inspect transfer
```

## Source Reference

Use these files when you need the exact request bodies, headers, or assertions:

| Area | File or folder |
| --- | --- |
| Standard provisioning order | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/provisioning/master.json` |
| Standard P2P test | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/p2p.json` |
| Golden-path provisioning order | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/provisioning/for_golden_path/master.json` |
| Golden-path tests order | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/master.json` |
| P2P golden-path variants | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/feature_tests/p2p_money_transfer` |
| FX happy path | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/fx/golden_path/feature_tests/happy_path/fx_tests.json` |
| Funds in/out | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/feature_tests/funds_in`, `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/feature_tests/funds_out` |
| Settlement management | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/collections/tests/golden_path/settlement_management` |
| Environment variables | `ml-core-test-harness/docker/ml-testing-toolkit/test-cases/environments/default-env.json` |
