"""Authenticated local TS control commands; never exposed as model tools."""

from urllib.parse import urlparse
import httpx2


class BusinessConflict(Exception):
    def __init__(self, code):
        self.code = code


class Bridge:
    def __init__(self, url, token):
        parsed = urlparse(url)
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or parsed.path != "/api/agent/commands"
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Explicit local business bridge required")
        self.url, self.token = url, token

    async def call(self, op, data):
        async with httpx2.AsyncClient(trust_env=False, follow_redirects=False, timeout=5) as client:
            response = await client.post(
                self.url, headers={"Authorization": "Bearer " + self.token}, json={"op": op, "data": data}
            )
            if response.status_code != 200:
                raise BusinessConflict(response.json().get("code", "CONFLICT"))
            return response.json()
