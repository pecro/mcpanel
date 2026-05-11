"""Background loop: warn via apprise when more than one mc-panel-managed world
is awake for more than COOLDOWN_TICKS consecutive ticks."""
from __future__ import annotations

import asyncio
import logging
import os

import httpx

from . import docker_client as dc

log = logging.getLogger("mc-panel.watchdog")

INTERVAL_SECS = int(os.environ.get("WATCHDOG_INTERVAL_SECS", "60"))
THRESHOLD_TICKS = int(os.environ.get("WATCHDOG_THRESHOLD_TICKS", "3"))
APPRISE_URL = os.environ.get("APPRISE_URL", "").strip()
RENOTIFY_AFTER_TICKS = int(os.environ.get("WATCHDOG_RENOTIFY_AFTER_TICKS", "30"))


async def _notify(awake_names: list[str]) -> None:
    msg = (
        f"mc-panel: {len(awake_names)} Minecraft worlds awake simultaneously: "
        f"{', '.join(awake_names)}. Expected ≤1."
    )
    if not APPRISE_URL:
        log.warning("APPRISE_URL not set — not sending. %s", msg)
        return
    try:
        async with httpx.AsyncClient(timeout=5) as c:
            await c.post(
                APPRISE_URL,
                json={"title": "Minecraft worlds simultaneously awake", "body": msg, "type": "warning"},
            )
        log.info("apprise notified: %s", msg)
    except Exception as e:  # noqa: BLE001
        log.error("apprise post failed: %s", e)


async def loop() -> None:
    consecutive = 0
    sent_at_tick = -RENOTIFY_AFTER_TICKS
    tick = 0
    while True:
        try:
            worlds = dc.list_worlds()
            awake = [w.name for w in worlds if w.awake]
            if len(awake) > 1:
                consecutive += 1
                if consecutive >= THRESHOLD_TICKS and (tick - sent_at_tick) >= RENOTIFY_AFTER_TICKS:
                    await _notify(awake)
                    sent_at_tick = tick
            else:
                consecutive = 0
        except Exception as e:  # noqa: BLE001
            log.warning("watchdog tick failed: %s", e)
        tick += 1
        await asyncio.sleep(INTERVAL_SECS)
