"""
form - Modal form (TextInput + Checkbox / RadioGroup / FileUpload).

WHAT : Opens a pop-up form to collect structured input (multiple text fields, etc.)
       and returns the submitted values as a dict. Called from slash-command or
       button-interaction handlers.
DEPS : discord.py>=2.6
PERMS: Send Messages
USAGE: # Inside a slash command or button interaction callback:
       data = await ask_form(interaction, "Trade Entry", [
           ("ticker", "Symbol", {}),
           ("qty",    "Quantity", {"placeholder": "number"}),
       ])   # -> {"ticker": ..., "qty": ...} or None on timeout
SAFETY: Modals can only be submitted by the user who owns the originating
        interaction. Do not use this to collect passwords or sensitive secrets.
DEMO  : python harness/interaction/form.py  (offline validation)

To add a Checkbox / RadioGroup / FileUpload inside a modal, wrap them in a Label:
   modal.add_item(discord.ui.Label(text="Agree",     component=discord.ui.Checkbox()))
   modal.add_item(discord.ui.Label(text="Tier",      component=discord.ui.RadioGroup(options=[...])))
   modal.add_item(discord.ui.Label(text="Attachment", component=discord.ui.FileUpload()))
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Tuple

import discord


class _FormModal(discord.ui.Modal):
    def __init__(
        self,
        title: str,
        fields: List[Tuple[str, str, Dict[str, Any]]],
        future: "asyncio.Future[Optional[Dict[str, str]]]",
    ) -> None:
        super().__init__(title=title[:45])
        self._future = future
        self._inputs: Dict[str, discord.ui.TextInput] = {}
        for key, label, kw in fields:
            ti = discord.ui.TextInput(label=label[:45], **kw)
            self._inputs[key] = ti
            self.add_item(ti)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        data = {k: ti.value for k, ti in self._inputs.items()}
        if not self._future.done():
            self._future.set_result(data)
        try:
            await interaction.response.send_message("Your input has been received.", ephemeral=True)
        except Exception:
            pass

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        if not self._future.done():
            self._future.set_result(None)


async def ask_form(
    interaction: discord.Interaction,
    title: str,
    fields: List[Tuple[str, str, Dict[str, Any]]],
    timeout: float = 300,
) -> Optional[Dict[str, str]]:
    """Open a modal from a slash-command or button interaction and return the
    submitted values as a dict.  Returns None if the modal times out.

    fields = [(key, label, textinput_kwargs), ...]
    """
    fut: asyncio.Future[Optional[Dict[str, str]]] = (
        asyncio.get_running_loop().create_future()
    )
    await interaction.response.send_modal(_FormModal(title, fields, fut))
    try:
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        return None


if __name__ == "__main__":
    async def _check() -> None:
        fut: asyncio.Future[Optional[Dict[str, str]]] = (
            asyncio.get_running_loop().create_future()
        )
        m = _FormModal("Form", [("a", "A", {}), ("b", "B", {"placeholder": "x"})], fut)
        assert len(m._inputs) == 2 and m.title == "Form"

    asyncio.run(_check())
    print("form: offline construction OK (2 TextInput fields)")
