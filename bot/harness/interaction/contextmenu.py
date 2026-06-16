"""
contextmenu - right-click context menus (user / message).

WHAT : App commands triggered by right-clicking a message or user.
       Registered and synced to a CommandTree, just like slash commands.
DEPS : discord.py>=2.6
PERMS: applications.commands scope
USAGE: tree = app_commands.CommandTree(client)
       cm = make_message_menu("Summarize", on_summarize)   # on_summarize(interaction, message)
       tree.add_command(cm)
       await tree.sync(guild=discord.Object(id=GUILD_ID))
       # Or use the decorator: @tree.context_menu(name="Info")  async def whois(interaction, member): ...
SAFETY: In each callback, verify interaction.user.id == ALLOWED_USER_ID before acting.
DEMO: python harness/interaction/contextmenu.py  (offline config validation)
"""

import discord
from discord import app_commands


def make_message_menu(name: str, handler) -> app_commands.ContextMenu:
    """Return a message context-menu command that calls *handler*.

    handler: async def(interaction: discord.Interaction, message: discord.Message)
    The second-argument annotation on the handler determines the command type.
    """
    return app_commands.ContextMenu(name=name, callback=handler)


def make_user_menu(name: str, handler) -> app_commands.ContextMenu:
    """Return a user context-menu command that calls *handler*.

    handler: async def(interaction: discord.Interaction, member: discord.Member)
    """
    return app_commands.ContextMenu(name=name, callback=handler)


if __name__ == "__main__":
    async def on_msg(interaction, message: discord.Message):
        pass

    cm = make_message_menu("Summarize", on_msg)
    assert cm.name == "Summarize"
    print("contextmenu: config OK")
