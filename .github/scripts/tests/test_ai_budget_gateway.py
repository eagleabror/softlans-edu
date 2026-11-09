import concurrent.futures
import datetime
import importlib.util
import json
import pathlib
import threading
import unittest
import urllib.error
import urllib.request
from decimal import Decimal
from unittest.mock import patch

source = pathlib.Path(__file__).resolve().parents[1] / "ai-budget-gateway.py"
spec = importlib.util.spec_from_file_location("gateway", source)
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class BudgetTests(unittest.TestCase):
    def test_full_context_reserved_and_second_request_rejected(self):
        budget = gateway.Budget()
        budget.reserve()
        self.assertEqual(budget.reserved, Decimal("0.541384"))
        self.assertLessEqual(budget.reserved, gateway.MAX_BUDGET_USD)
        with self.assertRaises(gateway.PolicyError):
            budget.reserve()

    def test_parallel_requests_cannot_overspend(self):
        budget = gateway.Budget()
        def attempt(_):
            try:
                budget.reserve()
                return True
            except gateway.PolicyError:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            self.assertEqual(sum(pool.map(attempt, range(30))), 1)

    def test_over_budget_fails_before_reserving(self):
        with patch.object(gateway, "MAX_BUDGET_USD", Decimal("0.01")):
            budget = gateway.Budget()
            with self.assertRaises(gateway.PolicyError):
                budget.reserve()
            self.assertEqual(budget.requests, 0)

    def test_tools_paid_tiers_and_token_overrides_cannot_escape_policy(self):
        request = gateway.constrained_request({
            "model": gateway.MODEL, "input": [
                {"type": "additional_tools", "tools": [{"type": "web_search"}]},
                {"role": "user", "content": "audit"},
            ],
            "tools": [{"type": "web_search"}], "tool_choice": "required",
            "max_output_tokens": 9999999, "service_tier": "priority",
            "previous_response_id": "remote-state", "background": True, "store": True,
        })
        self.assertEqual(request["tools"], [])
        self.assertEqual(request["tool_choice"], "none")
        self.assertEqual(request["max_output_tokens"], 8192)
        self.assertEqual(request["service_tier"], "default")
        self.assertFalse(request["store"])
        self.assertNotIn("previous_response_id", request)
        self.assertNotIn("background", request)
        self.assertEqual(request["input"], [{"role": "user", "content": "audit"}])

    def test_model_and_non_text_inputs_rejected(self):
        for request in [
            {"model": "expensive-model", "input": "audit"},
            {"model": gateway.MODEL, "input": [{"type": "input_image", "image_url": "https://evil"}]},
            {"model": gateway.MODEL, "input": [{"type": "function_call_output", "output": "secret"}]},
        ]:
            with self.assertRaises(gateway.PolicyError):
                gateway.constrained_request(request)

    def test_redirects_never_forward_authorization(self):
        with self.assertRaises(gateway.PolicyError):
            gateway.NoRedirect().redirect_request(None, None, 302, "", {}, "https://evil")

    def test_pricing_expiry_is_fail_closed(self):
        self.assertTrue(gateway.pricing_is_current(datetime.datetime(2026, 11, 9, tzinfo=datetime.timezone.utc)))
        self.assertFalse(gateway.pricing_is_current(gateway.PRICING_EXPIRES))


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.pricing = patch.object(gateway, "pricing_is_current", return_value=True)
        self.pricing.start()
        self.addCleanup(self.pricing.stop)
        class FreshHandler(gateway.Handler):
            budget = gateway.Budget()
        self.handler = FreshHandler
        self.server = gateway.http.server.ThreadingHTTPServer(("127.0.0.1", 0), FreshHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def post(self, payload, endpoint="/v1/responses"):
        req = urllib.request.Request(self.url + endpoint, json.dumps(payload).encode(), {
            "Authorization": "Bearer synthetic-test-only",
        })
        try:
            with urllib.request.urlopen(req, timeout=3) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def test_sse_roundtrip_and_no_paid_retry(self):
        stream = b'event: response.completed\ndata: {"ok":true}\n\n'
        with patch.object(gateway, "forward", return_value=("text/event-stream", stream)) as upstream:
            self.assertEqual(self.post({"model": gateway.MODEL, "input": "audit"}), (200, stream))
            self.assertEqual(self.post({"model": gateway.MODEL, "input": "retry"})[0], 403)
            upstream.assert_called_once()

    def test_upstream_error_is_redacted_and_still_consumes_budget(self):
        with patch.object(gateway, "forward", side_effect=RuntimeError("SECRET-EXCEPTION")) as upstream:
            status, body = self.post({"model": gateway.MODEL, "input": "audit"})
            self.assertEqual(status, 502)
            self.assertNotIn(b"SECRET", body)
            self.assertEqual(self.post({"model": gateway.MODEL, "input": "retry"})[0], 403)
            upstream.assert_called_once()

    def test_other_endpoints_and_oversize_requests_do_not_reach_upstream(self):
        with patch.object(gateway, "forward") as upstream:
            self.assertEqual(self.post({"input": "x"}, "/v1/files")[0], 403)
            self.assertEqual(self.post({"model": gateway.MODEL, "input": "x" * gateway.MAX_REQUEST_BYTES})[0], 403)
            upstream.assert_not_called()

    def test_expired_policy_blocks_api_without_breaking_other_ci_tests(self):
        with patch.object(gateway, "pricing_is_current", return_value=False), patch.object(gateway, "forward") as upstream:
            self.assertEqual(self.post({"model": gateway.MODEL, "input": "audit"})[0], 403)
            upstream.assert_not_called()


if __name__ == "__main__":
    unittest.main()
