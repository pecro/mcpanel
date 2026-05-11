"""Read selected metadata from a Minecraft level.dat. Wraps the `nbt`
PyPI package; the module is named level_dat to avoid shadowing it."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from nbt.nbt import NBTFile


def parse(path: Path) -> dict[str, Any]:
    """Return a flat dict of selected fields from level.dat. Missing fields
    are simply absent from the result; raises only on unreadable files."""
    f = NBTFile(filename=str(path))
    out: dict[str, Any] = {}
    data = f.get("Data") if hasattr(f, "get") else None
    if data is None and "Data" in f:
        data = f["Data"]
    if data is None:
        return out

    def maybe(key: str, attr: str | None = None) -> None:
        if key in data:
            v = data[key].value
            out[attr or key] = v

    maybe("LevelName")
    maybe("hardcore")
    maybe("Difficulty")
    maybe("GameType")
    maybe("DataVersion")
    if "Version" in data:
        ver = data["Version"]
        if "Name" in ver:
            out["Version_Name"] = ver["Name"].value
        if "Id" in ver:
            out["Version_Id"] = ver["Id"].value
    return out
