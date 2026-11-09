"""Bir run uchun qat’iy chegarali Responses relay. Secret va matn loglanmaydi.

Rasmiy Codex Action secret proxy’si ushbu lokal darvozaga keladi. Darvoza
root sifatida ishlaydi; kalit disk/env’da saqlanmaydi. Faqat fixed upstream.
"""

import datetime
import http.server
import json
import threading
import urllib.error
import urllib.request
from decimal import Decimal

MODEL = "gpt-6-luna"
CONTEXT_TOKENS = 1_050_000
MAX_OUTPUT_TOKENS = 8192
MAX_REQUESTS = 1
MAX_BUDGET_USD = Decimal("0.60")
# Conservative upper prices including documented long-context/cache-write tiers.
INPUT_USD_PER_MILLION = Decimal("0.50")
OUTPUT_USD_PER_MILLION = Decimal("2.00")
PRICING_EXPIRES = datetime.datetime(2026, 12, 9, tzinfo=datetime.timezone.utc)
UPSTREAM = "https://api.openai.com/v1/responses"
MAX_REQUEST_BYTES = 512_000
MAX_RESPONSE_BYTES = 2_000_000


class PolicyError(Exception):
    pass


def pricing_is_current(now=None):
    return (now or datetime.datetime.now(datetime.timezone.utc)) < PRICING_EXPIRES


class Budget:
    def __init__(self):
        self.lock = threading.Lock()
        self.requests = 0
        self.reserved = Decimal("0")

    def reserve(self):
        cost = (CONTEXT_TOKENS * INPUT_USD_PER_MILLION +
                MAX_OUTPUT_TOKENS * OUTPUT_USD_PER_MILLION) / 1_000_000
        with self.lock:
            if self.requests >= MAX_REQUESTS or self.reserved + cost > MAX_BUDGET_USD:
                raise PolicyError("API budjeti yoki so‘rov limiti tugadi")
            self.requests += 1
            self.reserved += cost
        # Never refunded on timeout, upstream failure or cancellation.


def constrained_request(payload):
    if not isinstance(payload, dict) or payload.get("model") != MODEL:
        raise PolicyError("Model ruxsat etilmagan")
    if not isinstance(payload.get("input"), (str, list)):
        raise PolicyError("Noto‘g‘ri audit kirishi")
    # Newer Codex versions declare tools inside an additional_tools input item,
    # independently of the top-level tools array. Drop both tool surfaces.
    text_input = payload["input"]
    if isinstance(text_input, list):
        text_input = [item for item in text_input if not
                      (isinstance(item, dict) and item.get("type") == "additional_tools")]
    # Reject image/file/audio and pre-existing tool invocations. No hidden input
    # modalities, billable hosted tools or remote conversation state.
    def inspect(value):
        if isinstance(value, dict):
            if "type" in value and value["type"] not in {"message", "input_text", "output_text"}:
                raise PolicyError("Faqat matnli auditga ruxsat berilgan")
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)
    inspect(text_input)
    result = {
        "model": MODEL,
        "input": text_input,
        "tools": [],
        "tool_choice": "none",
        "parallel_tool_calls": False,
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "service_tier": "default",
        "store": False,
        "stream": bool(payload.get("stream", True)),
        "reasoning": {"effort": "low"},
    }
    if isinstance(payload.get("instructions"), str):
        result["instructions"] = payload["instructions"]
    # Deliberately do not forward arbitrary provider params, previous_response_id,
    # background, user-controlled URLs, metadata, tools or service-tier overrides.
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise PolicyError("Upstream redirect taqiqlangan")


def forward(payload, authorization):
    request = urllib.request.Request(UPSTREAM, data=json.dumps(payload).encode(), headers={
        "Authorization": authorization,
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if payload["stream"] else "application/json",
        "Accept-Encoding": "identity",
    }, method="POST")
    with urllib.request.build_opener(NoRedirect).open(request, timeout=90) as response:
        body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise PolicyError("Javob hajm chegarasidan oshdi")
        return response.headers.get("Content-Type", "application/json"), body


class Handler(http.server.BaseHTTPRequestHandler):
    budget = Budget()

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        # Default HTTP access/error logs must never contain headers or content.
        pass

    def reply(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, b'{"ready":true}')
        else:
            self.reply(404, b'{"error":"endpoint rad etildi"}')

    def do_POST(self):
        try:
            if self.path != "/v1/responses":
                raise PolicyError("Endpoint ruxsat etilmagan")
            if not pricing_is_current():
                raise PolicyError("Tarif siyosati muddati tugagan")
            if self.headers.get("Transfer-Encoding"):
                raise PolicyError("Transfer encoding rad etildi")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_REQUEST_BYTES:
                raise PolicyError("So‘rov hajmi noto‘g‘ri")
            authorization = self.headers.get("Authorization", "")
            if not authorization.startswith("Bearer ") or "\n" in authorization or "\r" in authorization:
                raise PolicyError("Autentifikatsiya noto‘g‘ri")
            payload = constrained_request(json.loads(self.rfile.read(length)))
            self.budget.reserve()
            content_type, body = forward(payload, authorization)
            self.reply(200, body, content_type)
        except PolicyError:
            self.reply(403, '{"error":{"message":"AI xavfsizlik yoki budjet siyosati so‘rovni rad etdi"}}'.encode())
        except (ValueError, UnicodeError):
            self.reply(400, '{"error":{"message":"Noto‘g‘ri so‘rov"}}'.encode())
        except Exception:
            # Never print an exception: upstream responses/headers may be sensitive.
            self.reply(502, '{"error":{"message":"AI upstream javobi olinmadi; pullik retry yo‘q"}}'.encode())


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    threading.Timer(300, server.shutdown).start()
    server.serve_forever()
    server.server_close()


if __name__ == "__main__":
    main()
