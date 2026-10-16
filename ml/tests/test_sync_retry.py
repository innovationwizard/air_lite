"""The hourly sync retries a blip and does not retry a rejected request."""
import socket
import urllib.error
import xmlrpc.client

import sync_retry


class _Log:
    def __init__(self):
        self.warnings = []

    def warning(self, msg, *args):
        self.warnings.append(msg % args if args else msg)


def _http(code):
    return urllib.error.HTTPError('http://sb', code, 'x', hdrs=None, fp=None)


def test_502_is_retried_and_then_succeeds():
    calls = {'n': 0}

    def action():
        calls['n'] += 1
        if calls['n'] < 3:
            raise _http(502)
        return {'ok': True}

    log = _Log()
    assert sync_retry.call_with_retry(action, sync_retry.transient_http, log, 'PATCH products',
                                      sleep=lambda _s: None) == {'ok': True}
    assert calls['n'] == 3
    assert len(log.warnings) == 2


def test_409_is_not_retried():
    calls = {'n': 0}

    def action():
        calls['n'] += 1
        raise _http(409)

    try:
        sync_retry.call_with_retry(action, sync_retry.transient_http, _Log(), 'PATCH products',
                                  sleep=lambda _s: None)
    except urllib.error.HTTPError as exc:
        assert exc.code == 409
    else:
        raise AssertionError('expected HTTPError')
    assert calls['n'] == 1


def test_gives_up_after_five_attempts():
    calls = {'n': 0}

    def action():
        calls['n'] += 1
        raise urllib.error.URLError('timed out')

    try:
        sync_retry.call_with_retry(action, sync_retry.transient_http, _Log(), 'GET',
                                  sleep=lambda _s: None)
    except urllib.error.URLError:
        pass
    else:
        raise AssertionError('expected URLError')
    assert calls['n'] == sync_retry.ATTEMPTS


def test_odoo_fault_is_not_retried():
    calls = {'n': 0}

    def action():
        calls['n'] += 1
        raise xmlrpc.client.Fault(4, 'Access Denied')

    try:
        sync_retry.call_with_retry(action, sync_retry.transient_odoo, _Log(), 'product.product',
                                  sleep=lambda _s: None)
    except xmlrpc.client.Fault as exc:
        assert exc.faultCode == 4
    else:
        raise AssertionError('expected Fault')
    assert calls['n'] == 1


def test_odoo_502_is_retried():
    calls = {'n': 0}

    def action():
        calls['n'] += 1
        if calls['n'] == 1:
            raise xmlrpc.client.ProtocolError('http://odoo', 502, 'Bad Gateway', {})
        return [1]

    assert sync_retry.call_with_retry(action, sync_retry.transient_odoo, _Log(), 'search_read',
                                      sleep=lambda _s: None) == [1]
    assert calls['n'] == 2


def test_connection_reset_is_transient():
    assert sync_retry.transient_http(ConnectionResetError('reset'))
    assert sync_retry.transient_odoo(socket.timeout('timed out'))
    assert not sync_retry.transient_http(_http(400))


def test_backoff_is_full_jitter_inside_the_window():
    for n, cap in ((1, 1.0), (2, 2.0), (3, 4.0), (4, 8.0), (5, 8.0)):
        for _ in range(20):
            wait = sync_retry.backoff_seconds(n)
            assert 0 <= wait <= cap
