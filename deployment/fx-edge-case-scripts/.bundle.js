/* fxlib.js — shared prelude for Mojaloop ISO20022 FX edge-case scenarios.
 * Concatenate with a scenario file and pipe into:
 *   kubectl exec -i -n demo moja-ml-testing-toolkit-backend-0 -- node -
 * Everything runs from INSIDE the cluster, hitting backend Services directly
 * (this deployment has no unified hub gateway — see plan §9.10).
 */
const http = require('http');
const crypto = require('crypto');
const { TransformFacades } = require('@mojaloop/ml-schema-transformer-lib');
const { Ilp } = require('@mojaloop/sdk-standard-components');
const { ulid } = require('ulidx');

TransformFacades.FSPIOP.configure({ isTestingMode: true });

const SVC = {
  als:        { host: 'moja-account-lookup-service',  port: 80 },
  quoting:    { host: 'moja-quoting-service',         port: 80 },
  mlapi:      { host: 'moja-ml-api-adapter-service',  port: 80 },
  centralledger: { host: 'moja-centralledger-service', port: 80 },
};

const PAYER = 'e2e-sim1', PAYEE = 'e2e-sim2', FXP = 'e2e-sim-fxp1';
const SRC_CCY = 'XXX', TGT_CCY = 'XTS';

const uuid = () => crypto.randomUUID();
/* ISO20022 mode needs ULIDs, not UUIDs, for the id fields that map onto
 * PmtId.InstrId (pattern ^[0-9A-HJKMNP-TV-Z]{26}$) and PmtId.EndToEndId
 * (max 35 chars — a 36-char UUID overflows it; this is the same failure
 * §9.10 hit as "must NOT have more than 35 characters"). */
const id = () => ulid();
const isoDate = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

// ISO20022-form FSPIOP media type — the literal `iso20022` segment is what
// @mojaloop/central-services-shared's parseAcceptHeader requires when apiType
// is iso20022 (plan §9.9).
const mt = (resource, version = '2.0') =>
  `application/vnd.interoperability.iso20022.${resource}+json;version=${version}`;

function headers(resource, source, destination, version) {
  const h = {
    'Accept': mt(resource, version),
    'Content-Type': mt(resource, version),
    'Date': new Date().toUTCString(),
    'FSPIOP-Source': source,
  };
  if (destination) h['FSPIOP-Destination'] = destination;
  return h;
}

function send({ svc, method, path, headers: hdrs, body }) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const opts = {
    hostname: SVC[svc].host, port: SVC[svc].port, path, method,
    headers: { ...hdrs, ...(payload ? { 'Content-Length': payload.length } : {}) },
  };
  return new Promise((resolve) => {
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

function report(label, res) {
  console.log(`\n--- ${label} ---`);
  console.log(`HTTP ${res.status}${res.error ? ' ERROR: ' + res.error : ''}`);
  if (res.body) {
    try { console.log(JSON.stringify(JSON.parse(res.body), null, 1)); }
    catch { console.log(res.body.slice(0, 2000)); }
  }
  return res;
}

// --- ILP v4 -----------------------------------------------------------------
const noop = () => {};
const stubLog = { log: noop, debug: noop, info: noop, warn: noop, error: noop,
                  verbose: noop, silly: noop, isDebugEnabled: false };
stubLog.push = () => stubLog; stubLog.child = () => stubLog;
const ilp = Ilp.ilpFactory(Ilp.ILP_VERSIONS.v4, { secret: 'fx-edge-case-secret', logger: stubLog });

/* Build a matching {fulfilment, condition, ilpPacket} triple for a transfer.
 * central-ledger derives the condition from the ILP packet in ISO20022 mode,
 * so the packet must be genuinely well-formed, not a copied sample. */
function ilpFor({ transferId, quoteId, amount, currency, expiration }) {
  const transactionObject = {
    transactionId: transferId,
    quoteId: quoteId || uuid(),
    payee:  { partyIdInfo: { partyIdType: 'MSISDN', partyIdentifier: '9990002001', fspId: PAYEE } },
    payer:  { partyIdInfo: { partyIdType: 'MSISDN', partyIdentifier: '9990001001', fspId: PAYER } },
    amount: { currency, amount },
    transactionType: { scenario: 'TRANSFER', initiator: 'PAYER', initiatorType: 'CONSUMER' },
    expiration,
  };
  return ilp.getResponseIlp(transactionObject);
}

module.exports = {}; // keep node happy when concatenated

/* prepareTransfer — POST /transfers as the payer; returns the ids + ILP triple.
 * Returns once the switch has accepted it (202); caller should pause before
 * asserting on position, since the position handler is async. */
async function prepareTransfer({ amount = '10', currency = SRC_CCY, expiryMs = 10 * 60 * 1000,
                                 payer = PAYER, payee = PAYEE, label = 'POST /transfers' } = {}) {
  const transferId = id();
  const quoteId = id();
  const expiration = isoDate(expiryMs);
  const ilpTriple = ilpFor({ transferId, quoteId, amount, currency, expiration });
  const hdrs = headers('transfers', payer, payee);
  const iso = await TransformFacades.FSPIOP.transfers.post({
    body: { transferId, payerFsp: payer, payeeFsp: payee,
            amount: { currency, amount },
            ilpPacket: ilpTriple.ilpPacket, condition: ilpTriple.condition, expiration },
    headers: hdrs,
  });
  const res = await send({ svc: 'mlapi', method: 'POST', path: '/transfers', headers: hdrs, body: iso.body });
  report(`${label} (id=${transferId}, ${amount} ${currency}, expires ${expiration})`, res);
  return { transferId, expiration, ...ilpTriple, prepareRes: res };
}

async function positions(label = 'positions') {
  console.log(`\n--- ${label} ---`);
  for (const p of [PAYER, PAYEE, FXP]) {
    const r = await send({ svc: 'centralledger', method: 'GET',
      path: `/participants/${p}/positions`, headers: { Accept: 'application/json' } });
    console.log('  ' + p + ': ' + r.body);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Baseline happy path: prepare -> fulfil -> COMMITTED.
 * Validates the direct-request toolkit end to end before edge cases build on it. */
(async () => {
  const t = await prepareTransfer({ label: 'prepare' });
  await sleep(4000);
  await positions('after prepare (expect payer position = 10)');

  const hdrs = headers('transfers', PAYEE, PAYER);
  const iso = await TransformFacades.FSPIOP.transfers.put({
    body: { fulfilment: t.fulfilment, completedTimestamp: isoDate(), transferState: 'COMMITTED' },
    headers: hdrs,
    params: { ID: t.transferId },
  });
  console.log('\n--- ISO PUT body ---');
  console.log(JSON.stringify(iso.body, null, 1));

  const res = await send({ svc: 'mlapi', method: 'PUT', path: '/transfers/' + t.transferId,
                           headers: hdrs, body: iso.body });
  report('PUT /transfers/' + t.transferId + ' (correct fulfilment)', res);

  await sleep(5000);
  await positions('after fulfil (expect payer 10 committed, payee -10)');
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
