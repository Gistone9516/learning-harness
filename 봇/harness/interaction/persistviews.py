"""
persistviews - Persistent views that survive bot restarts.

WHAT  : Uses timeout=None and fixed custom_id buttons so that buttons on
        previously sent messages keep working even after the bot restarts.
DEPS  : discord.py>=2.6
PERMS : Send Messages
USAGE : # 1) Persistent view class (PersistentButtons below):
        #    timeout=None, each item has a fixed custom_id.
        # 2) Register once at bot startup:
        #    client.add_view(PersistentButtons())  (in on_ready or setup_hook)
        # 3) Attach to a message once:
        #    await CHANNEL.send("...", view=PersistentButtons())
SAFETY: Check ALLOWED_USER_ID inside callbacks.
        Keep custom_id values unique and stable -- changing them breaks
        buttons on old messages.
DEMO  : python harness/interaction/persistviews.py  (offline verification)
"""

import discord


class PersistentButtons(discord.ui.View):
    def __init__(self) -> None:
        super().__init__(timeout=None)   # key requirement for persistence

    @discord.ui.button(label="Approve", style=discord.ButtonStyle.success, custom_id="persist:approve")
    async def approve(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await interaction.response.send_message("Approved", ephemeral=True)

    @discord.ui.button(label="Reject", style=discord.ButtonStyle.danger, custom_id="persist:reject")
    async def reject(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await interaction.response.send_message("Rejected", ephemeral=True)


# Restore on restart: call once when the bot starts up.
#   client.add_view(PersistentButtons())


if __name__ == "__main__":
    v = PersistentButtons()
    assert v.timeout is None and v.is_persistent()
    print("persistviews: persistent view OK (custom_id + timeout=None)")
