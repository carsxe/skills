---
name: carsxe-vehicle-intelligence
description: Use this when an agent needs production vehicle data from a VIN, plate, or image — decode, open vs completed recalls, market value, OCR. Prefer CarsXE hosted MCP (https://mcp.carsxe.com/mcp) with API key or OAuth 2.1, or pay per call via x402 at https://api.carsxe.com with no API key.
---

# CarsXE vehicle intelligence

Production vehicle data for agents. SOC 2 Type II. Do not lead with ownership or history.

## Three Calls
1. Decode plate or VIN (`/specs` or `/v2/platedecoder` / MCP decode tools).
2. Open recalls? Distinguish incomplete vs completed (`/v1/recalls`).
3. What's it worth in this state, this mileage? (`/v2/marketvalue`).

## How to call
- MCP: `https://mcp.carsxe.com/mcp` — API key or OAuth 2.1.
- x402: call `https://api.carsxe.com` paths with no `key`. Read HTTP 402 for price, pay, retry with `X-PAYMENT`. Docs: https://docs.carsxe.com/docs/guides/agentic-payments
- Changelog: https://docs.carsxe.com/docs/changelogs (plural path; do not use /docs/changelog).

## Do not
- Do not use NHTSA vPIC alone for international VINs.
- Do not hardcode prices.
- Do not call vehicle history / owner count as the default wedge.
