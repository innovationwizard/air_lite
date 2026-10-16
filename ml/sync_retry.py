"""Retry a single I/O call when the failure is a blip, not the request.

The hourly syncs (Wilmer, Alexis) do one urllib/XML-RPC call and, on any
error, mark the whole hour failed. On 2026-10-15 20:04 UTC a Supabase 502
during one products PATCH did that: the previous snapshot was intact, and
the page painted the failed attempt. These calls are safe to send again —
a PATCH by primary key writes the same value, and the merge-duplicates
inserts key on their conflict columns. An Odoo Fault (permissions, a
missing field) is the request itself and is not retried.

Five attempts. The wait before retry n is full jitter over
(0, min(8s, 1s × 2^(n-1))]: about 1s, then 2s, 4s, 8s. A gateway blip is
gone in a couple of seconds. A Supabase that stays down still fails the
hour, and the waits stay short enough that this job cannot run into the
next one.
"""

import random
import socket
import time
import urllib.error
import xmlrpc.client

ATTEMPTS = 5
BACKOFF_BASE_S = 1.0
BACKOFF_CAP_S = 8.0
RETRY_HTTP = frozenset({429, 500, 502, 503, 504})


def backoff_seconds(retry_number):
    """Wait before retry `retry_number` (1-based). Full jitter, capped at 8s."""
    window = min(BACKOFF_CAP_S, BACKOFF_BASE_S * (2 ** (retry_number - 1)))
    return random.uniform(0, window)


def transient_http(exc):
    """Supabase/PostgREST: gateway and throttle codes, and a call that never
    got a status (timeout, connection reset). A 4xx other than 429 is the
    request — a 409 on odoo_id will fail the same way on the next try."""
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in RETRY_HTTP
    if isinstance(exc, urllib.error.URLError):
        return True
    return isinstance(exc, (TimeoutError, ConnectionError, socket.timeout))


def transient_odoo(exc):
    """XML-RPC after login. A dropped connection or a 502 from Odoo's HTTP
    front is worth another try. Fault is Odoo rejecting the call."""
    if isinstance(exc, xmlrpc.client.Fault):
        return False
    if isinstance(exc, xmlrpc.client.ProtocolError):
        return getattr(exc, 'errcode', None) in RETRY_HTTP
    return isinstance(exc, (TimeoutError, ConnectionError, socket.timeout, socket.gaierror))


def call_with_retry(action, is_transient, log, label, sleep=time.sleep):
    """Run `action`. On a transient error, wait and try again, up to ATTEMPTS.
    The last error is re-raised. `sleep` is injectable so tests do not wait."""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return action()
        except Exception as exc:
            if isinstance(exc, urllib.error.HTTPError):
                exc.close()
            if attempt >= ATTEMPTS or not is_transient(exc):
                raise
            wait = backoff_seconds(attempt)
            log.warning('%s attempt %d/%d failed (%s); retrying in %.2fs',
                        label, attempt, ATTEMPTS, exc, wait)
            sleep(wait)
    return None  # unreachable: the loop either returns or raises
