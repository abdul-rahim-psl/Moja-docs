# US-MLA-07 — Retry and Circuit-Break on PPA Failures

**Epic:** Epic 3 — MLA: Delivery to PPA & Offset Management
**Source:** `docs/user stories/cch-mla-user-stories.md`

---

## Description

When PPA returns a 5xx or times out, MLA retries with exponential backoff and jitter before escalating. When PPA returns a 4xx (invalid envelope), MLA logs and advances the offset without retrying. Retry exhaustion and the circuit breaker are two coordinated mechanisms, not one: exhausting an event's own retry budget parks that event and keeps periodically retrying it, and it is exactly this repeated failure that accumulates toward the breaker's trip threshold. Once the breaker trips on sustained consecutive failures, MLA stops attempting the paused event directly and instead pauses partition consumption entirely, re-probing PPA's health on a timer rather than continuing to hammer a known-down PPA.

## Acceptance Criteria

- On PPA 5xx or timeout: retry up to 3 attempts with exponential backoff (base 1s / 2s / 4s) plus random jitter on each interval. The Kafka offset is not advanced while retries are in progress.
- Once an event's 3-attempt retry budget is exhausted, MLA raises an alert and **pauses the offset on that event** rather than advancing past it — this is still a transient-failure case (FSD §5.6), so the event is retried again once PPA recovers, not discarded. MLA continues periodically retrying this same paused event; each such failure counts toward the circuit breaker's consecutive-failure threshold below. Nothing is left undefined in between: the offset simply never advances past a failed transient event, the same principle as every other transient case in this story.
- On PPA 4xx: log the full envelope as an error, raise an operations alert, and advance the offset (permanent failure — retrying will not fix a malformed envelope).
- After N consecutive failures (N is configurable) — counting both an event's own exhausted retry attempts and repeated failures on the paused event afterward — the circuit breaker trips: MLA stops attempting the paused event directly and pauses consumption on the affected partition(s) entirely. It does not advance any further offsets.
- The circuit breaker re-probes PPA's health on a configurable timer interval. It resumes partition consumption once PPA is healthy again (a successful health probe), picking back up on the event that was paused.
- Jitter is genuinely random (not fixed), so concurrent MLA workers do not synchronize their retry storms.
- An unreadable Kafka message (malformed JSON, bad base64) is skipped: offset advanced, logged, alert raised — not retried.

## Method

1. **Classify the failure** — on a non-200 response from US-MLA-06, distinguish 4xx (permanent) from 5xx/timeout (transient).
2. **Retry transient failures** — for 5xx/timeout, retry up to 3 times with exponential backoff plus jitter, without advancing the offset.
3. **Park on retry exhaustion** — once the 3 attempts are used up, alert and pause on this event rather than advancing past it; keep periodically retrying it in the background.
4. **Fail permanent failures immediately** — for 4xx, log, alert, and advance the offset without retrying.
5. **Track consecutive failures** — count both the exhausted-retry outcome and each subsequent failure on the paused event; once the configurable threshold N is reached, trip the circuit breaker.
6. **Pause on trip** — stop attempting the paused event directly; stop consuming from the affected partition(s) entirely; no further offsets are advanced.
7. **Re-probe and resume** — on a configurable interval, probe PPA's health; resume partition consumption, starting from the paused event, once a probe succeeds.

## Assumptions

- The circuit breaker threshold (N failures) and re-probe interval are configurable without a restart.
- MLA's own consumer offset on the audit topic is the recovery mechanism for paused partitions — the 7-day retention on the audit topic is the buffer. No separate DLQ is needed on the MLA side.
- For 4xx and JWS-rejection cases, advancing the offset immediately is correct per the current design. This is Open Item #8 in the FSD and must be confirmed with CCH before implementation is finalised.
- **Timeout value itself is unconfirmed — FSD Open Item #1 — see R-31 below.**
- As with US-MLA-05, this story's alerts (4xx errors, circuit-breaker trips) have no confirmed destination yet — see US-MON-01 in `cch-crosscutting-user-stories.md` (R-37).

## Todos

1. Implement the retry/backoff/jitter logic and the 4xx-vs-5xx classification.
2. Implement the retry-exhaustion park-and-continue behaviour for a single event, feeding into the circuit breaker's failure count.
3. Implement the circuit-breaker state machine (trip, pause, re-probe, resume-from-paused-event) with configurable threshold and interval.
4. Write tests (Jest, 95% coverage target) covering: retry/backoff/jitter timing, the retry-exhausted park-and-continue path, 4xx immediate-advance path, breaker trip/pause/resume cycle, and the unreadable-message skip path.
5. Confirm the offset-advance-on-permanent-failure policy with CCH (Open Item #8) and the retry/timeout budget values (Open Item #1 / R-31).
